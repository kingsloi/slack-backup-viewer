# Slack Backup Viewer

![app screenshot](screenshot.jpg?raw=true)

## Usage
- Use [edemaine/slack-backup](https://github.com/edemaine/slack-backup) to download a copy of your Slack Workspace
- Use this repo's `slack-backup-viewer.js` to spin up a quick node.js server to view your backup in the browser

# Instructions
- `--path=` is the location of your Slack backup directory
- `--workspace='Your Workspace Name'`

```
npm install
node slack-backup-viewer.js --path=/Users/kingsloi/Sites/slack-backup-repo/backup --workspace='⚰  TECH OPS'
> Server is running on http://localhost:8889
```
