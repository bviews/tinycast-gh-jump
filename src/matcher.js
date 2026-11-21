// Pure matching logic: turns "myrepo pu 12" into ranked GitHub targets.

// Last-word suffixes, modeled on the Alfred GitHub workflow habits (pu = PRs, i = issues).
export const TARGETS = {
  pu: { path: "pulls", label: "Pull Requests", item: "pull" },
  pr: { path: "pulls", label: "Pull Requests", item: "pull" },
  p: { path: "pulls", label: "Pull Requests", item: "pull" },
  i: { path: "issues", label: "Issues", item: "issues" },
  is: { path: "issues", label: "Issues", item: "issues" },
  a: { path: "actions", label: "Actions" },
  ac: { path: "actions", label: "Actions" },
  r: { path: "releases", label: "Releases" },
  b: { path: "branches", label: "Branches" },
  c: { path: "commits", label: "Commits" },
  s: { path: "settings", label: "Settings" },
  w: { path: "wiki", label: "Wiki" },
};

export const REPO_TARGET = { path: "", label: "Repository" };

// Split the query into repo words, an optional target suffix and an optional number.
export function parseQuery(text) {
  const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  let number = null;
  let target = null;
  if (words.length >= 2 && /^#?\d+$/.test(words[words.length - 1])) {
    number = words.pop().replace("#", "");
  }
  if (words.length >= 2 && TARGETS[words[words.length - 1]]) {
    target = TARGETS[words.pop()];
  }
  if (number && !target) target = TARGETS.i; // "repo 12" -> issue/PR #12 (GitHub redirects issues/N to pull/N)
  return { words, target, number };
}

// Score one repo against the repo words; null means no match.
export function scoreRepo(fullName, words) {
  const full = fullName.toLowerCase();
  const name = full.slice(full.indexOf("/") + 1);
  let score = 0;
  for (const w of words) {
    let s = 0;
    if (w.includes("/")) {
      if (full === w) s = 120;
      else if (full.startsWith(w)) s = 90;
      else if (full.includes(w)) s = 60;
    } else if (name === w) s = 100;
    else if (name.startsWith(w)) s = 80;
    else if (new RegExp(`(^|[-_.])${escapeRe(w)}`).test(name)) s = 65;
    else if (name.includes(w)) s = 45;
    else if (full.includes(w)) s = 30;
    else if (isSubsequence(w, name)) s = 10;
    if (!s) return null;
    score += s;
  }
  return score - name.length * 0.1; // shorter names win ties
}

export function buildResults(repos, text, usage = {}, limit = 30) {
  const { words, target, number } = parseQuery(text);
  const now = Date.now();
  const ranked = [];
  for (const repo of repos) {
    let base = words.length ? scoreRepo(repo.n, words) : 0;
    if (base === null) continue;
    const used = usage[repo.n] || 0;
    const pushedDays = repo.p ? (now - Date.parse(repo.p)) / 86400000 : 9999;
    base += Math.min(used, 20) * 3 + (pushedDays < 30 ? 8 : pushedDays < 180 ? 3 : 0);
    ranked.push({ repo, score: base });
  }
  ranked.sort((a, b) => b.score - a.score);

  const results = [];
  for (const { repo } of ranked.slice(0, limit)) {
    const url = `https://github.com/${repo.n}`;
    if (target && number) {
      results.push({ repo, target, number, url: `${url}/${target.item || target.path}/${number}`, label: `${target.label === "Issues" ? "Issue/PR" : target.label.replace(/s$/, "")} #${number}` });
    } else if (target) {
      results.push({ repo, target, url: `${url}/${target.path}`, label: target.label });
    } else {
      results.push({ repo, target: REPO_TARGET, url, label: "Repository" });
    }
  }
  return results;
}

// Second step, after a repo is chosen: the pages you can jump into.
export const PAGES = [
  { path: "pulls", item: "pull", label: "Pull Requests", words: ["pull", "pulls", "pr", "pu", "p", "pull request", "合并请求"] },
  { path: "issues", item: "issues", label: "Issues", words: ["issue", "issues", "i", "is", "问题"] },
  { path: "actions", label: "Actions", words: ["actions", "action", "a", "ci", "workflow"] },
  { path: "releases", label: "Releases", words: ["releases", "release", "r", "tag", "tags"] },
  { path: "branches", label: "Branches", words: ["branches", "branch", "b"] },
  { path: "commits", label: "Commits", words: ["commits", "commit", "c", "log"] },
  { path: "", label: "Repository", words: ["repository", "repo", "home", "code"] },
  { path: "settings", label: "Settings", words: ["settings", "setting", "s"] },
  { path: "wiki", label: "Wiki", words: ["wiki", "w"] },
];

// Filter PAGES by what was typed in step two, e.g. "pu", "issue", "pull 12".
export function buildPageResults(fullName, text) {
  const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  let number = null;
  if (words.length && /^#?\d+$/.test(words[words.length - 1])) number = words.pop().replace("#", "");
  const q = words.join(" ");
  const base = `https://github.com/${fullName}`;
  const ranked = [];
  PAGES.forEach((page, order) => {
    let score = 1000 - order; // keep the default order when nothing is typed
    if (q) {
      const label = page.label.toLowerCase();
      if (page.words.includes(q)) score = 3000 - order;
      else if (label.startsWith(q) || page.words.some((w) => w.startsWith(q))) score = 2000 - order;
      else if (label.includes(q)) score = 1500 - order;
      else return;
    }
    ranked.push({ page, score });
  });
  ranked.sort((a, b) => b.score - a.score);
  const results = ranked.map(({ page }) => ({ page, url: page.path ? `${base}/${page.path}` : base, label: page.label }));
  if (number) {
    // Bare number -> issues/N, which GitHub also redirects to the PR when N is a pull request.
    const first = q ? results.find((r) => r.page.item) : results.find((r) => r.page.path === "issues");
    if (!first) return [];
    const kind = first.page.item === "pull" ? "PR" : "Issue/PR";
    return [{ page: first.page, url: `${base}/${first.page.item}/${number}`, label: `${kind} #${number}` }];
  }
  return results;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isSubsequence(needle, hay) {
  let i = 0;
  for (const ch of hay) if (ch === needle[i]) i++;
  return i === needle.length;
}
