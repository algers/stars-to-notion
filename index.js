/* ================================================================================

  stars-to-notion
  Save stars in a Notion database automatically with GitHub Actions
  GitHub: https://github.com/algers/stars-to-notion
  

================================================================================ */

const { Client, LogLevel } = require("@notionhq/client")
const dotenv = require("dotenv")
const { Octokit } = require("octokit")
const _ = require("lodash")
dotenv.config()

if (!(
        process.env.GH_STARS_USER &&
        process.env.GH_USER_TOKEN &&
        process.env.NOTION_KEY &&
        process.env.NOTION_DATABASE_ID
    )) {
    console.error("Missing environment variable.")
    process.exit(1)
}

const octokit = new Octokit({
    auth: process.env.GH_USER_TOKEN,
    request: {},
})
const notion = new Client({
    auth: process.env.NOTION_KEY,
    logLevel: LogLevel.DEBUG,
})

const databaseId = process.env.NOTION_DATABASE_ID
const OPERATION_BATCH_SIZE = 10

/**
 * Local map to store  GitHub star ID to its Notion pageId.
 * { [starId: string]: string }
 */
const gitHubStarsIdToNotionPageId = {}

/**
 * Initialize local data store.
 * Then sync with GitHub.
 */
setInitialGitHubToNotionIdMap().then(syncNotionDatabaseWithGitHub)

/**
 * Get and set the initial data store with stars currently in the database.
 */
async function setInitialGitHubToNotionIdMap() {
    const currentStars = await getStarsFromNotionDatabase()

    for (const { pageId, starId }
        of currentStars) {
        gitHubStarsIdToNotionPageId[starId] = pageId
    }
}

async function syncNotionDatabaseWithGitHub() {
    // Get all user's currently starred repositories
    console.log("\nFetching stars from Notion DB...")
    const stars = await getGitHubStarsForUser()
    console.log(`Fetched ${stars.length} stars from GitHub user.`)

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
            page_size: 10,
            database_id: databaseId,
            start_cursor: cursor,
        })
        pages.push(...results)
        if (!next_cursor) {
            break
        }
        cursor = next_cursor
    }
    console.log(`${pages.length} stars successfully fetched from Notion.`)
    return pages.map(page => {
        return {
            pageId: page.id,
            starId: page.properties["Star ID"].number,
        }
    })
}

/**
 * Gets stars from a GitHub user.
 *
 * https://docs.github.com/en/rest/guides/traversing-with-pagination
 * https://docs.github.com/en/rest/reference/activity#list-stargazers
 *
 * @returns {Promise<Array<{ id: number, title: string, labels: array, url: string, starred: number, stargazers: number, forks: number, language: string, description: string, watchers: number, created: string, homepage: string, size: number, pushed: string }>>}
 */

async function getGitHubStarsForUser() {
    const stars = []

    const iterator = octokit.paginate.iterator(
        octokit.rest.activity.listReposStarredByUser, {
            headers: {
                accept: "application/vnd.github.v3.star+json",
            },
            username: process.env.GH_STARS_USER,
            per_page: 100,
        }
    )

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
                size: star.repo.size,
            })
        }
    }
    return stars
}

/**
 * Determines which stars already exist in the Notion database.
 *
 * @param {Array<{ id: number, title: string, labels: array, url: string, starred: number, stargazers: number, forks: number, language: string, description: string, watchers: number, created: string, homepage: string, size: number, pushed: string }>}
 * @returns {{
 *   pagesToCreate: Array<{ id: number, title: string, labels: array, url: string, starred: number, stargazers: number, forks: number, language: string, description: string, watchers: number, created: string, homepage: string, size: number, pushed: string }>;
 *   pagesToUpdate: Array<{ pageId: string, id: number, title: string, labels: array, url: string, starred: number, stargazers: number, forks: number, language: string, description: string, watchers: number, created: string, homepage: string, size: number, pushed: string }>
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
    return {
        pagesToCreate,
        pagesToUpdate,
    }
}

/**
 * Creates new pages in Notion.
 *
 * https://developers.notion.com/reference/post-page
 *
 * @param {Array<{ id: number, title: string, labels: array, url: string, starred: number, stargazers: number, forks: number, language: string, description: string, watchers: number, created: string, homepage: string, size: number, pushed: string }>} pagesToCreate
 */
async function createPages(pagesToCreate) {
    const pagesToCreateChunks = _.chunk(pagesToCreate, OPERATION_BATCH_SIZE)
    for (const pagesToCreateBatch of pagesToCreateChunks) {
        console.log(pagesToCreateBatch)
        await Promise.all(
            pagesToCreateBatch.map(star =>
                notion.pages.create({
                    parent: {
                        database_id: databaseId,
                    },
                    properties: getPropertiesFromStar(star),
                })
            )
        )
        console.log(`Completed batch size: ${pagesToCreateBatch.length}`)
    }
}

/**
 * Updates provided pages in Notion.
 *
 * https://developers.notion.com/reference/patch-page
 *
 * @param {Array<{ pageId: string, id: number, title: string, labels: array, url: string, starred: number, stargazers: number, forks: number, language: string, description: string, watchers: number, created: string, homepage: string, size: number, pushed: string }>} pagesToUpdate
 */
async function updatePages(pagesToUpdate) {
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
}

//*========================================================================
// Helpers
//*========================================================================

/**
 * Returns the GitHub star to conform to this database's schema properties.
 *
 * @param {{ id: number, title: string, labels: array, url: string, starred: number, stargazers: number, forks: number, language: string, description: string, watchers: number, created: string, homepage: string, size: number, pushed: string, }} star
 */
function getPropertiesFromStar(star) {
    const {
        id,
        title,
        labels,
        url,
        starred,
        stargazers,
        forks,
        language,
        description,
        watchers,
        created,
        homepage,
        size,
        pushed,
    } = star

    const item = {
        "Name": {
            title: [{ type: "text", text: { content: title } }],
        },
        "Star ID": {
            number: id,
        },
        "URL": {
            url,
        },
        "Starred": {
            date: {
                start: starred,
            },
        },
        "Created": {
            date: {
                start: created,
            },
        },
        "Stargazers": {
            number: stargazers,
        },
        "Watchers": {
            number: watchers,
        },
        "Size (Kb)": {
            number: size,
        },
        "Forks": {
            number: forks,
        },
        "Pushed": {
            date: {
                start: pushed,
            },
        },
        "Homepage": ((homepage && homepage !== '') ? {
            url: homepage,
        } : null),
        "Description": (description ? {
            rich_text: [{
                type: "text",
                text: {
                    content: description,
                },
            }, ],
        } : null),
        "Language": (language ? {
            select: {
                name: language,
            },
        } : null),
        "Topics": (labels ? {
            multi_select: labels.map(topic => {
                return {
                    name: topic,
                }
            }),
        } : null),
    }

    return Object.fromEntries(Object.entries(item).filter(([_, v]) => v != null))


}
