# tinycast-gh-jump

An Alfred-style GitHub jumper for [Tinycast](https://tinycast.dev/) (it also follows the Raycast extension format).
Fuzzy-find one of your repos, pick a page, and browse its pull requests or issues without leaving the launcher.

## Usage

1. Run **GH Jump** (give it an alias such as `gh` in Tinycast settings).
2. Type part of a repo name, e.g. `myrepo`, and press **Enter**.
3. Type the page you want — `pull`, `issue`, `actions`, `release`, `branch`, `commit` — and press **Enter**.
   Pull requests and issues open as a list inside Tinycast; other pages open in the browser.

Shortcuts on the first screen:

| Input | Result |
|---|---|
| `myrepo pu` | PR list of `myrepo` |
| `myrepo i` | issue list of `myrepo` |
| `myrepo a` / `r` / `b` / `c` | Actions / Releases / Branches / Commits in the browser |
| `myrepo pu 12` | PR #12 in the browser |
| `myrepo 12` | issue or PR #12 in the browser |
| `owner/name i` | exact repo, issue list |

In the PR / issue list: switch Open / Closed / Merged / All from the dropdown, type keywords to search on GitHub,
or a number to jump to it. **⌘K** has copy link / number / title / branch name.

Repos you open more often rank higher. **⌘O** opens the repo home page, **⌘R** refreshes the repo list.

## How it works

- Uses the [GitHub CLI](https://cli.github.com/) you are already logged in with (`gh auth login`); no extra token is stored.
- Repo list: `gh api /user/repos` (your own, collaborator and organization repos), cached for 6 hours in `~/.cache/gh-jump/`.
- PR / issue lists: `gh pr list` / `gh issue list`, cached per repo so the last result shows instantly while it refreshes.
- Nothing is sent anywhere except GitHub through `gh`.

## Install

Requirements: macOS, Tinycast with extensions enabled, Node.js, and `gh` logged in.

```bash
git clone https://github.com/bviews/tinycast-gh-jump.git
cd tinycast-gh-jump
npm install
npm run build
```

Then in Tinycast: **Settings → Extensions → Install → Add from folder**, choose this folder.

Tinycast copies the extension when adding it. After changing the code, rebuild and copy `gh.js` over the installed one
(quit Tinycast first):

```bash
npm run build
cp gh.js ~/Library/Application\ Support/com.abueammar.tinycast/extensions/gh-jump/gh.js
```

## Notes

- Tinycast reserves **Tab** for switching screens, so selection uses **Enter**.
- `gh` is looked up in `/opt/homebrew/bin`, `/usr/local/bin` and `/usr/bin`.

## License

MIT
