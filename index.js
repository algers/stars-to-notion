/* ================================================================================

  notion-github-sync.
  
  Glitch example: https://glitch.com/edit/#!/notion-github-sync
  Find the official Notion API client @ https://github.com/makenotion/notion-sdk-js/

================================================================================ */

const { Client, LogLevel, APIErrorCode, APIResponseError } = require("@notionhq/client")
const dotenv = require("dotenv")
const { Octokit } = require("octokit")
const _ = require("lodash")

dotenv.config()
const octokit = new Octokit({ auth: process.env.GITHUB_KEY, request: {} })
const notion = new Client({ auth: process.env.NOTION_KEY, logLevel: LogLevel.DEBUG })

const databaseId = process.env.NOTION_DATABASE_ID
const OPERATION_BATCH_SIZE = 1

/**
 * Local map to store  GitHub issue ID to its Notion pageId.
 * { [issueId: string]: string }
 */
const gitHubStarsIdToNotionPageId = {}

/**
 * Initialize local data store.
 * Then sync with GitHub.
 */
setInitialGitHubToNotionIdMap().then(syncNotionDatabaseWithGitHub)

/**
 * Get and set the initial data store with issues currently in the database.
 */
async function setInitialGitHubToNotionIdMap() {
    const currentStars = await getStarsFromNotionDatabase()

    for (const { pageId, starId }
        of currentStars) {
        gitHubStarsIdToNotionPageId[starId] = pageId
    }
}

async function syncNotionDatabaseWithGitHub() {
    // Get all issues currently in the provided GitHub repository.
    console.log("\nFetching issues from Notion DB...")
    const stars = await getGitHubStarsForUser()
    console.log(`Fetched ${stars.length} stars from GitHub repository.`)

    // Group stars into those that need to be created or updated in the Notion database.
    const { pagesToCreate, pagesToUpdate } = getNotionOperations(stars)

    // Create pages for new stars.
    console.log(`\n${pagesToCreate.length} new stars to add to Notion.`)
    await createPages(pagesToCreate)

    // Updates pages for existing stars.
    console.log(`\n${pagesToUpdate.length} stars to update in Notion.`)
    await updatePages(pagesToUpdate)

    // Success!
    console.log("\n✅ Notion database is synced with GitHub.")
}

/**
 * Gets pages from the Notion database.
 *
 * @returns {Promise<Array<{ pageId: string, starId: number }>>}
 */

async function getStarsFromNotionDatabase() {
    const pages = []
    let cursor = undefined
    while (true) {
        const { results, next_cursor } = await notion.databases.query({
            page_size: 25,
            database_id: databaseId,
            start_cursor: cursor,
        })
        pages.push(...results)
        if (!next_cursor) {
            break
        }
        cursor = next_cursor
    }
    console.log(`${pages.length} stars successfully fetched.`)
    return pages.map(page => {
        return {
            pageId: page.id,
            starId: page.properties["Repository ID"].number,
        }
    })
}

/**
 * Gets issues from a GitHub repository. Pull requests are omitted.
 *
 * https://docs.github.com/en/rest/guides/traversing-with-pagination
 * https://docs.github.com/en/rest/reference/issues
 *
 * @returns {Promise<Array<{ number: number, title: string, state: "open" | "closed", comment_count: number, url: string }>>}
 */

async function getGitHubStarsForUser() {
    const stars = []
    const iterator = octokit.paginate.iterator(octokit.rest.activity.listReposStarredByAuthenticatedUser, {
        headers: {
            accept: 'application/vnd.github.v3.star+json'
        },
        per_page: 100
    })

    for await (const { data }
        of iterator) {
        for (const star of data) {

            stars.push({
                id: star.repo.id,
                title: star.repo.full_name,
                url: star.repo.html_url,
                starred: star.starred_at,
                labels: star.repo.topics,
                stargazers: star.repo.stargazers_count,
                forks: star.repo.forks_count,
                language: star.repo.language,
                description: star.repo.description,
                pushed: star.repo.pushed_at,
                watchers: star.repo.watchers_count,
                created: star.repo.created_at,
                homepage: star.repo.homepage,
                size: star.repo.size
            })

        }
    }
    return stars
}

/**
 * Determines which issues already exist in the Notion database.
 *
 * @param {Array<{ number: number, title: string, state: "open" | "closed", comment_count: number, url: string }>} 
 * @returns {{
 *   pagesToCreate: Array<{ number: number, title: string, state: "open" | "closed", comment_count: number, url: string }>;
 *   pagesToUpdate: Array<{ pageId: string, number: number, title: string, state: "open" | "closed", comment_count: number, url: string }>
 * }}
 */
function getNotionOperations(stars) {
    const pagesToCreate = []
    const pagesToUpdate = []
    for (const star of stars) {
        const pageId = gitHubStarsIdToNotionPageId[star.id]
        if (pageId) {
            pagesToUpdate.push({
                ...star,
                pageId,
            })
        } else {
            pagesToCreate.push(star)
        }
    }
    return { pagesToCreate, pagesToUpdate }
}

/**
 * Creates new pages in Notion.
 *
 * https://developers.notion.com/reference/post-page
 *
 * @param {Array<{ number: number, title: string, state: "open" | "closed", comment_count: number, url: string }>} pagesToCreate
 */
async function createPages(pagesToCreate) {
    try {
        const pagesToCreateChunks = _.chunk(pagesToCreate, OPERATION_BATCH_SIZE)
        for (const pagesToCreateBatch of pagesToCreateChunks) {
            await Promise.all(
                pagesToCreateBatch.map(star =>
                    notion.pages.create({
                        parent: { database_id: databaseId },
                        properties: getPropertiesFromStar(star),
                    })
                )
            )
            console.log(`Completed batch size: ${pagesToCreateBatch.length}`)
        }
    } catch (error) {
        console.error(error)
    }
}

/**
 * Updates provided pages in Notion.
 *
 * https://developers.notion.com/reference/patch-page
 *
 * @param {Array<{ pageId: string, number: number, title: string, state: "open" | "closed", comment_count: number, url: string }>} pagesToUpdate
 */
async function updatePages(pagesToUpdate) {
    try {
        const pagesToUpdateChunks = _.chunk(pagesToUpdate, OPERATION_BATCH_SIZE)
        for (const pagesToUpdateBatch of pagesToUpdateChunks) {
            await Promise.all(
                pagesToUpdateBatch.map(({ pageId, ...star }) =>
                    notion.pages.update({
                        page_id: pageId,
                        properties: getPropertiesFromStar(star),
                    })
                )
            )
            console.log(`Completed batch size: ${pagesToUpdateBatch.length}`)
        }
    } catch (error) {
        console.error(error)
    }
}

//*========================================================================
// Helpers
//*========================================================================

/**
 * Returns the GitHub issue to conform to this database's schema properties.
 *
 * @param {{ number: number, title: string, state: "open" | "closed", comment_count: number, url: string }} issue
 */
function getPropertiesFromStar(star) {
    const { id, title, labels, url, starred, stargazers, forks, language, description, watchers, created, homepage, size } = star

    const item = {
        "Repository ID": {
            number: id
        },
        Name: {
            title: [{ type: "text", text: { content: title } }],
        },
        "Repo URL": {
            url,
        },
        "Starred": {
            date: { start: starred }
        },
        "Created": {
            date: { start: created }
        },
        "Stargazers": {
            number: stargazers
        },
        "Watchers": {
            number: watchers
        },
        "Size": {
            number: size
        },
        "Forks": {
            number: forks
        }
    }
    if (homepage) {
        item["Homepage"] = {
            url
        }
    }
    if (language) {
        item["Language"] = {
            select: { name: language },
        }
    }

    if (description) {
        item["Description"] = {
            rich_text: [{ type: "text", text: { content: description } }]
        }
    }

    if (Object.keys(labels).length > 0) {

        const label = labels.map(topic => {
            return {
                name: topic
            }
        })
        item["Topics"] = {
            multi_select: label,
        }
    }

    return item

}