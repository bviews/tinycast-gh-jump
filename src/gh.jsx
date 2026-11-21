import { Action, ActionPanel, Color, Icon, List, showToast, Toast } from "@raycast/api";
import { useEffect, useMemo, useRef, useState } from "react";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildPageResults, buildResults } from "./matcher.js";

const CACHE_DIR = path.join(os.homedir(), ".cache", "gh-jump");
const ITEMS_DIR = path.join(CACHE_DIR, "items");
const REPOS_FILE = path.join(CACHE_DIR, "repos.json");
const USAGE_FILE = path.join(CACHE_DIR, "usage.json");
const MAX_AGE_MS = 6 * 60 * 60 * 1000;
const GH_CANDIDATES = ["/opt/homebrew/bin/gh", "/usr/local/bin/gh", "/usr/bin/gh"];

const KINDS = {
  pull: {
    cmd: "pr",
    noun: "PR",
    fields: "number,title,state,author,updatedAt,url,labels,isDraft,headRefName,reviewDecision",
  },
  issues: { cmd: "issue", noun: "Issue", fields: "number,title,state,author,updatedAt,url,labels,comments" },
};

// ---------- small helpers ----------

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
}

function recordUse(name) {
  const usage = readJson(USAGE_FILE, {});
  usage[name] = (usage[name] || 0) + 1;
  writeJson(USAGE_FILE, usage);
}

function runGh(args) {
  const bin = GH_CANDIDATES.find((p) => fs.existsSync(p)) || "gh";
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ""}` },
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(err.trim() || `gh exited with ${code}`))));
  });
}

async function fetchRepos() {
  const out = await runGh([
    "api",
    "--paginate",
    "/user/repos?per_page=100&affiliation=owner,collaborator,organization_member",
    "--jq",
    ".[] | {n:.full_name, d:.description, p:.pushed_at}",
  ]);
  return out.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

async function fetchItems(repo, kind, state, search) {
  const k = KINDS[kind];
  const args = [k.cmd, "list", "-R", repo, "--state", state, "--limit", "100", "--json", k.fields];
  if (search) args.push("--search", search);
  return JSON.parse(await runGh(args));
}

function itemsCacheFile(repo, kind, state) {
  return path.join(ITEMS_DIR, `${repo.replace("/", "__")}__${kind}__${state}.json`);
}

function relTime(iso) {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 60) return `${Math.max(m, 1)} 分钟前`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} 小时前`;
  const d = Math.round(h / 24);
  if (d < 60) return `${d} 天前`;
  return iso.slice(0, 10);
}

function itemIcon(kind, it) {
  if (kind === "pull") {
    if (it.state === "MERGED") return { source: Icon.CheckCircle, tintColor: Color.Purple };
    if (it.state === "CLOSED") return { source: Icon.XMarkCircle, tintColor: Color.Red };
    if (it.isDraft) return { source: Icon.Shuffle, tintColor: Color.SecondaryText };
    return { source: Icon.Shuffle, tintColor: Color.Green };
  }
  if (it.state === "CLOSED") return { source: Icon.CheckCircle, tintColor: Color.Purple };
  return { source: Icon.Circle, tintColor: Color.Green };
}

function pageIcon(page) {
  if (page.item === "pull") return Icon.Shuffle;
  if (page.path === "issues") return Icon.Circle;
  if (page.path === "actions") return Icon.Play;
  if (page.path === "releases") return Icon.Tag;
  if (page.path === "branches") return Icon.Tree;
  if (page.path === "commits") return Icon.Clock;
  if (page.path === "settings") return Icon.Gear;
  return Icon.Book;
}

// Which in-Tinycast list a page maps to, if any.
function listKind(page) {
  if (page.item === "pull") return "pull";
  if (page.path === "issues") return "issues";
  return null;
}

// ---------- level 3: the PR / issue list of one repo ----------

function ItemList({ repo, kind }) {
  const k = KINDS[kind];
  const [state, setState] = useState("open");
  const [text, setText] = useState("");
  const [items, setItems] = useState(() => readJson(itemsCacheFile(repo, kind, "open"), []));
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  useEffect(() => {
    const q = text.trim().replace(/^#/, "");
    const isNumber = /^\d+$/.test(q);
    const search = q && !isNumber ? q : "";
    if (!search) setItems(readJson(itemsCacheFile(repo, kind, state), []));
    const my = ++seq.current;
    setLoading(true);
    const timer = setTimeout(
      async () => {
        try {
          const fresh = await fetchItems(repo, kind, state, search);
          if (my !== seq.current) return;
          setItems(fresh);
          if (!search) writeJson(itemsCacheFile(repo, kind, state), fresh);
        } catch (e) {
          if (my === seq.current) showToast({ style: Toast.Style.Failure, title: `拉取 ${k.noun} 失败`, message: String(e.message || e) });
        } finally {
          if (my === seq.current) setLoading(false);
        }
      },
      search ? 350 : 0,
    );
    return () => clearTimeout(timer);
  }, [text, state]);

  const q = text.trim().replace(/^#/, "");
  const shown = /^\d+$/.test(q) ? items.filter((it) => String(it.number).startsWith(q)) : items;
  const listUrl = `https://github.com/${repo}/${kind === "pull" ? "pulls" : "issues"}`;

  return (
    <List
      isLoading={loading}
      filtering={false}
      onSearchTextChange={setText}
      navigationTitle={`${repo} · ${k.noun}s`}
      searchBarPlaceholder={`搜索 ${repo} 的 ${k.noun}（标题关键字或编号）`}
      searchBarAccessory={
        <List.Dropdown tooltip="状态" value={state} onChange={setState}>
          <List.Dropdown.Item title="Open" value="open" />
          <List.Dropdown.Item title="Closed" value="closed" />
          {kind === "pull" ? <List.Dropdown.Item title="Merged" value="merged" /> : null}
          <List.Dropdown.Item title="全部" value="all" />
        </List.Dropdown>
      }
    >
      {/^\d+$/.test(q) ? (
        <List.Item
          key="jump"
          icon={Icon.ArrowRight}
          title={`打开 #${q}`}
          subtitle={repo}
          actions={
            <ActionPanel>
              <Action.OpenInBrowser url={`https://github.com/${repo}/${kind}/${q}`} onOpen={() => recordUse(repo)} />
            </ActionPanel>
          }
        />
      ) : null}
      {shown.map((it) => {
        const accessories = [];
        if (kind === "pull" && it.isDraft) accessories.push({ tag: "Draft" });
        if (kind === "pull" && it.reviewDecision === "APPROVED") accessories.push({ tag: { value: "Approved", color: Color.Green } });
        if (kind === "pull" && it.reviewDecision === "CHANGES_REQUESTED") accessories.push({ tag: { value: "Changes", color: Color.Orange } });
        for (const l of (it.labels || []).slice(0, 2)) accessories.push({ tag: l.name });
        if (kind === "issues" && it.comments?.length) accessories.push({ icon: Icon.SpeechBubble, text: String(it.comments.length) });
        accessories.push({ text: relTime(it.updatedAt), tooltip: it.updatedAt });
        return (
          <List.Item
            key={it.url}
            icon={itemIcon(kind, it)}
            title={`#${it.number} ${it.title}`}
            subtitle={it.author?.login || ""}
            keywords={[String(it.number)]}
            accessories={accessories}
            actions={
              <ActionPanel>
                <Action.OpenInBrowser url={it.url} onOpen={() => recordUse(repo)} />
                <Action.CopyToClipboard title="复制链接" content={it.url} />
                <Action.CopyToClipboard title="复制编号" content={`#${it.number}`} />
                <Action.CopyToClipboard title="复制标题" content={it.title} />
                {kind === "pull" && it.headRefName ? <Action.CopyToClipboard title="复制分支名" content={it.headRefName} /> : null}
                <Action.OpenInBrowser title={`在浏览器打开 ${k.noun} 列表`} url={listUrl} />
              </ActionPanel>
            }
          />
        );
      })}
      {!loading && shown.length === 0 ? <List.EmptyView title={`没有符合条件的 ${k.noun}`} description="换个状态或关键字试试" /> : null}
    </List>
  );
}

// ---------- level 2: pick a page of the chosen repo ----------

function RepoPages({ repo }) {
  const [text, setText] = useState("");
  const results = useMemo(() => buildPageResults(repo.n, text), [text]);
  return (
    <List
      filtering={false}
      onSearchTextChange={setText}
      navigationTitle={repo.n}
      searchBarPlaceholder={`${repo.n} → 输入 pull / issue / actions / release，可跟编号`}
    >
      {results.map((r) => {
        const kind = listKind(r.page);
        const isNumbered = /#\d+$/.test(r.label);
        const open = <Action.OpenInBrowser key="open" url={r.url} onOpen={() => recordUse(repo.n)} />;
        const push = kind && !isNumbered ? (
          <Action.Push key="push" title={`查看 ${KINDS[kind].noun} 列表`} icon={Icon.List} target={<ItemList repo={repo.n} kind={kind} />} />
        ) : null;
        return (
          <List.Item
            key={r.url}
            icon={pageIcon(r.page)}
            title={r.label}
            subtitle={repo.n}
            accessories={push ? [{ icon: Icon.ChevronRight }] : []}
            actions={
              <ActionPanel>
                {push ? [push, open] : [open]}
                <Action.CopyToClipboard title="复制链接" content={r.url} />
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}

// ---------- level 1: fuzzy-find a repo ----------

export default function Command() {
  const cached = readJson(REPOS_FILE, null);
  const [repos, setRepos] = useState(cached?.repos || []);
  const [usage] = useState(() => readJson(USAGE_FILE, {}));
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");

  async function refresh(manual) {
    setLoading(true);
    try {
      const fresh = await fetchRepos();
      writeJson(REPOS_FILE, { fetchedAt: Date.now(), repos: fresh });
      setRepos(fresh);
      if (manual) showToast({ style: Toast.Style.Success, title: `已更新 ${fresh.length} 个仓库` });
    } catch (e) {
      showToast({ style: Toast.Style.Failure, title: "拉取仓库失败", message: String(e.message || e) });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!cached || Date.now() - cached.fetchedAt > MAX_AGE_MS) refresh(false);
  }, []);

  const results = useMemo(() => buildResults(repos, text, usage), [repos, text, usage]);

  return (
    <List
      isLoading={loading}
      filtering={false}
      onSearchTextChange={setText}
      searchBarPlaceholder="搜仓库，回车选中后再输入 pull、issue；也可直接 myrepo pu"
    >
      {results.map((r) => {
        const home = `https://github.com/${r.repo.n}`;
        const open = <Action.OpenInBrowser key="open" url={r.url} onOpen={() => recordUse(r.repo.n)} />;
        const choose = <Action.Push key="choose" title="选择页面（PR / Issue…）" icon={Icon.ArrowRight} target={<RepoPages repo={r.repo} />} />;
        // "myrepo pu" / "api i": go straight to the in-Tinycast list; other suffixes open the browser.
        const kind = r.target && !r.number ? listKind(r.target) : null;
        let primary;
        if (r.label === "Repository") primary = [choose, open];
        else if (kind) primary = [<Action.Push key="list" title={`查看 ${KINDS[kind].noun} 列表`} icon={Icon.List} target={<ItemList repo={r.repo.n} kind={kind} />} />, open];
        else primary = [open, choose];
        return (
          <List.Item
            key={r.url}
            icon={Icon.Book}
            title={r.repo.n}
            subtitle={r.repo.d || ""}
            accessories={[{ tag: r.label }]}
            actions={
              <ActionPanel>
                {primary}
                <Action.OpenInBrowser title="打开仓库主页" url={home} shortcut={{ modifiers: ["cmd"], key: "o" }} onOpen={() => recordUse(r.repo.n)} />
                <Action.CopyToClipboard title="复制链接" content={r.url} />
                <Action title="刷新仓库列表" icon={Icon.ArrowClockwise} shortcut={{ modifiers: ["cmd"], key: "r" }} onAction={() => refresh(true)} />
              </ActionPanel>
            }
          />
        );
      })}
      {!loading && repos.length > 0 && results.length === 0 ? (
        <List.EmptyView title="没有匹配的仓库" description="⌘R 刷新仓库列表" />
      ) : null}
    </List>
  );
}
