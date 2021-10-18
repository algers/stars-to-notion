# stars-to-notion

Add a users starred repositories to a Notion database using GitHub Actions.

## Usage

### 1. Fork or clone this repository

Fork a repository by following the guide [here](https://docs.github.com/en/get-started/quickstart/fork-a-repo)

### 2. Create Notion Database

To create a Notion database that will work without modifying `index.js`, duplicate [this empty database template](https://heavenly-straw-aa6.notion.site/fd83c7e92f124740a09311d15798fb1a?v=65e930fbb92842e09a265537d1369922).

### 3. Setup Secrets for GitHub Action workflow

```zsh
GH_USER_TOKEN=<your-github-personal-access-token>
NOTION_KEY=<your-notion-api-key>
NOTION_DATABASE_ID=<notion-database-id>
GH_STARS_USER=<github-user-to-fetch-stars>
```


You can create your Notion API key [here](https://www.notion.com/my-integrations).

You can create your GitHub Personal Access token by following the guide [here](https://docs.github.com/en/github/authenticating-to-github/creating-a-personal-access-token).

Setup repository secrets for workflows by following the guide [here](https://github.com/Azure/actions-workflow-samples/blob/master/assets/create-secrets-for-GitHub-workflows.md)


### 4. Modify workflow trigger and schedule

The workflow is triggered in one of two ways:

- Push to `master` or `main` branches
- Scheduled 4AM UTC daily


Edit the configuration by modfying `.github/workflows/main.yml`

```yaml
on:
  push:
    branches:
      - master
      - main
  schedule:
    - cron: "0 4 * * *"
```

You can find cron schedule examples [here](https://crontab.guru/examples.html)