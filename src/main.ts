import { Octokit } from "@octokit/rest";
import dotenv from "dotenv"
import { createWriteStream, existsSync, mkdirSync } from "fs";
const yargs = require('yargs')
import { HttpsProxyAgent } from "hpagent";
import url from  'node:url';
import logger from './logger';
import { Agent } from "https";


const main = async () => {
    dotenv.config();
    const { repos, endpoint, outdir, production, token, proxyUrl } = acceptCommandLineArgs();
    await run(repos, endpoint, outdir, production, token, proxyUrl);
};

// The main entrypoint for the application
main();

function getAgent(proxyUrl: string | undefined): Agent | undefined {
    if (typeof proxyUrl != 'undefined') {
        logger.info('Configuring GitHub API requests to use provided proxy');
        return new HttpsProxyAgent({
            proxy: proxyUrl,
            proxyRequestOptions: {
                rejectUnauthorized: false
            },
            rejectUnauthorized: false
        });
    } else {
        return undefined;
    }
}

async function run(repos: any, endpoint: string, outdir: string, production: boolean, token: string, proxyUrl: string | undefined) {
    const promises: any = [];
    // Check if archive output dir already exists
    let message: string = `Directory ${outdir} already exists`
    if (!existsSync(outdir)) {
        mkdirSync(outdir, { recursive: true });
        message = `Created directory ${outdir}`
    }
    logger.info(message)

    const agent = getAgent(proxyUrl);

    const octokit = new Octokit({
        auth: token,
        baseUrl: endpoint,
        request: {
            agent
        }
    })
    repos.forEach((repo: any) => {
        promises.push(startOrgMigration(repo.org, repo.repo, octokit, production));
    });
    const migrations: { org: string, migrationId: number }[] = await Promise.all(promises);
    logger.debug(migrations);
    await checkMigrationStatus(migrations, outdir, octokit);
}

async function startOrgMigration(org: string, repo: string, octokit: Octokit, production: boolean) {
    let migrationId: number | undefined;
    const delay = Math.floor(Math.random() * 5000);
    try {

        const response = await octokit.request('POST /orgs/{org}/migrations', {
            org: org,
            repositories: [repo],
            lock_repositories: production
        })
        migrationId = response.data.id;
    } catch (error) {
        logger.error(error)
    }
    return { org, migrationId: migrationId };
}

async function checkMigrationStatus(migrations: { org: string, migrationId: number }[], outdir: string, octokit: Octokit) {
    const promises: any = [];
    migrations.forEach((migration: { org:string, migrationId: number}) => {
        promises.push(checkStatusAndArchiveDownload(migration, outdir, octokit));
    });

    return Promise.all(promises).then((values: {migrationId: number, migrationStatus: string}[]) => {
        logger.info(JSON.stringify(values));
    });
}

async function checkStatusAndArchiveDownload(migration: { org: string, migrationId: number }, outdir: string, octokit: Octokit) {
    /**
     * 
     */
    let migrationStatus: string;
    let attempts = 0;
    const maxAttempts = 180;
    const delayInMilliseconds = 60 * 1000;
    while (true) {
        try {
            const response = await octokit.request(`GET /orgs/{org}/migrations/${migration.migrationId.toString()}`, {
                org: migration.org,
                migration_id: migration.migrationId
            });
            migrationStatus = response.data.state;
        } catch (error) {
            logger.error(`Failed to get status for migration ${migration.migrationId}.`);
            logger.error(error);
            migrationStatus = "Unknown";
        }

        logger.info(`Migration ${migration.migrationId} status: ${migrationStatus}.`);

        if (migrationStatus === "exported") {
            const filePath = `${outdir}/migration_archive_${migration.migrationId}.tar.gz`;
            logger.info(`Migration ${migration.migrationId} is complete.`);
            logger.info(`Downloading migration ${migration.migrationId} archive to ${filePath}.`)
            const response = await octokit.request<any>('GET /orgs/{org}/migrations/{migration_id}/archive', {
                org: migration.org,
                migration_id: migration.migrationId
            })
            const fileStream = createWriteStream(filePath);
            fileStream.write(Buffer.from(response.data));
            fileStream.end();
            logger.info(`Migration ${migration.migrationId} archive downloaded to ${filePath}.`)
            return { migrationId: migration.migrationId, migrationStatus };
        } else if (migrationStatus === "failed") {
            logger.error(`Archive generation failed for migration ${migration.migrationId}.`);
            return { migrationId: migration.migrationId, migrationStatus };
        } else {
            attempts++;
            if (attempts >= maxAttempts) {
                logger.error(`Maximum number of attempts (${maxAttempts}) reached for migration ${migration.migrationId}.`);
                return { migrationId: migration.migrationId, migrationStatus };
            } else {
                logger.info(`Waiting ${delayInMilliseconds / 1000} seconds before checking migration status again.`);
                await new Promise(resolve => setTimeout(resolve, delayInMilliseconds));
            }
        }
    }
}

export function acceptCommandLineArgs(): { 
    repos: { org: string, repo: string }[], 
    endpoint: string, 
    outdir: string, 
    production: boolean,
    token: string,
    proxyUrl: string | undefined
} { const argv = yargs.default(process.argv.slice(2))
        .env('GITHUB')
        .option('repos', {
            alias: 'r',
            env: 'GITHUB_REPOS',
            description: 'Comma delimited list of orgs/repos (ex. github/github,torvalds/linux)',
            type: 'string',
            demandOption: true,
        })
        .option('endpoint', {
            alias: 'e',
            env: 'GITHUB_ENDPOINT',
            description: 'The api endpoint of the github instance (ex. api.github.com)',
            type: 'string',
            demandOption: true,
        })
        .option('outdir', {
            alias: 'o',
            env: 'GITHUB_OUTDIR',
            description: 'The output directory for the files. (ex. archives)',
            type: 'string',
            default: "archives",
            demandOption: false,
        })
        .option('production', {
            alias: 'p',
            env: 'GITHUB_PRODUCTION',
            description: 'Defines whether this is a production migration (locks the source repos).',
            type: 'boolean',
            default: false,
            demandOption: false,
        })
        .option('authToken', {
            alias: 't',
            env: 'GITHUB_AUTH_TOKEN',
            description: 'The personal access token for the GHES Migration API.',
            type: 'string',
            demandOption: true,
        })
        .option('proxyUrl', {
            env: 'GITHUB_PROXY_URL',
            description: 'The proxy URL to use when connecting to the GitHub API',
            type: 'string',
            demandOption: false
        }).argv;
    let repoObjs: { org: string, repo: string }[] = [];
    argv.repos.split(",").forEach((repo: string) => {
        repoObjs.push({
            org: repo.split("/")[0].trim(),
            repo: repo.split("/")[1].trim()
        })
    });
    return { repos: repoObjs, endpoint: argv.endpoint, outdir: argv.outdir, production: argv.production, token: argv.authToken, proxyUrl: argv.proxyUrl };
}
