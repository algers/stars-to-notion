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
const octokit = new Octokit({
    auth: process.env.GH_USER_TOKEN,
    request: {},
})
const notion = new Client({
    auth: process.env.NOTION_KEY,
    logLevel: LogLevel.DEBUG,
})

const databaseId = process.env.NOTION_DATABASE_ID
const OPERATION_BATCH_SIZE = 1

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
            starId: page.properties["ID"].number,
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

    const iterator = await octokit.paginate.iterator(
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
    try {
        const pagesToCreateChunks = _.chunk(pagesToCreate, OPERATION_BATCH_SIZE)
        for (const pagesToCreateBatch of pagesToCreateChunks) {
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
    } catch (error) {
        console.error(error)
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
        ID: {
            number: id,
        },
        Name: {
            title: [{
                type: "text",
                text: {
                    content: title,
                },
            }, ],
        },
        URL: {
            url,
        },
        Starred: {
            date: {
                start: starred,
            },
        },
        Created: {
            date: {
                start: created,
            },
        },
        Stargazers: {
            number: stargazers,
        },
        Watchers: {
            number: watchers,
        },
        "Size (Kb)": {
            number: size,
        },
        Forks: {
            number: forks,
        },
        Pushed: {
            date: {
                start: pushed,
            },
        },
        Homepage: homepage ? {
            url: homepage,
        } : null,
        Description: description ? {
            rich_text: [{
                type: "text",
                text: {
                    content: description,
                },
            }, ],
        } : null,
        Language: {
            select: {
                name: language,
            },
        },
        Topics: labels ? {
            multi_select: labels.map(topic => {
                return {
                    name: topic,
                }
            }),
        } : null,
    }

    Object.fromEntries(Object.entries(item).filter(([_, v]) => v != null))

    return item
}