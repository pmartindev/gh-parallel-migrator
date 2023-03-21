import { Octokit } from "@octokit/rest";
import { env } from "process";
import dotenv from "dotenv"
import { createWriteStream, existsSync, mkdirSync } from "fs";
const yargs = require('yargs')

dotenv.config()

const main = async () => {
    const { repos, endpoint, outdir } = acceptCommandLineArgs();
    await run(repos, endpoint, outdir);
};

main();

async function run(repos: any, endpoint: string, outdir: string) {
    const promises: any = [];
    if (!existsSync(outdir)) {
        mkdirSync(outdir, { recursive: true });
        console.log(`Created directory ${outdir}`);
      } else {
        console.log(`Directory ${outdir} already exists`);
      }
    repos.forEach((repo: any) => {
        promises.push(startOrgMigration(repo.org, repo.repo, endpoint));
    });
    const migrations: { org: string, migrationId: number }[] = await Promise.all(promises);
    console.log(migrations);
    await checkMigrationStatus(migrations, endpoint);
}

async function startOrgMigration(org: string, repo: string, endpoint: string) {
    const octokit = new Octokit({
        auth: env.GITHUB_TOKEN,
        baseUrl: endpoint
    })
    let migration_id: number | undefined;
    try {
        const response = await octokit.request('POST /orgs/{org}/migrations', {
            org: org,
            repositories: [repo],
            lock_repositories: true
        })
        migration_id = response.data.id;
    } catch (error) {
        console.log("ERROR" + error)
    }
    return { org, migration_id };
}

async function checkMigrationStatus(migrationIds: { org: string, migrationId: number }[], endpoint: string) {
    const octokit = new Octokit({
        auth: env.GITHUB_TOKEN,
        baseUrl: endpoint
    });

    const promises: any = [];
    migrationIds.forEach((migrationId: any) => {
        promises.push(checkSingleMigrationStatus(migrationId, octokit));
    });

    return Promise.all(promises).then((values) => {
        console.log(values);
    });
}

async function checkSingleMigrationStatus(migrationId: { org: string, migration_id: number }, octokit: Octokit) {
    let migrationStatus: string;
    let attempts = 0;
    const maxAttempts = 10;
    const delay = 10000;
    while (true) {
        try {
            const response = await octokit.request(`GET /orgs/{org}/migrations/${migrationId.migration_id.toString()}`, {
                org: migrationId.org,
                migration_id: migrationId.migration_id
            });
            migrationStatus = response.data.state;
        } catch (error) {
            console.log(`ERROR: Failed to get status for migration ${migrationId.migration_id}.`);
            console.log(error);
            migrationStatus = "Unknown";
        }

        console.log(`Migration ${migrationId.migration_id} status: ${migrationStatus}.`);

        if (migrationStatus === "exported") {
            const filePath = `archive/migration_archive_${migrationId.migration_id}.tar.gz`;
            console.log(`Migration ${migrationId.migration_id} is complete.`);
            console.log(`Downloading migration ${migrationId.migration_id} archive to ${filePath}.`)
            const response = await octokit.request<any>('GET /orgs/{org}/migrations/{migration_id}/archive', {
                org: migrationId.org,
                migration_id: migrationId.migration_id
            })
            const fileStream = createWriteStream(filePath);
            fileStream.write(Buffer.from(response.data));
            fileStream.end();
            console.log(`Migration ${migrationId.migration_id} archive downloaded to ${filePath}.`)
            return { migrationId: migrationId.migration_id, migrationStatus: migrationStatus };
        } else {
            attempts++;
            if (attempts >= maxAttempts) {
                console.log(`ERROR: Maximum number of attempts (${maxAttempts}) reached for migration ${migrationId.migration_id}.`);
                return { migrationId: migrationId.migration_id, migrationStatus };
            } else {
                console.log(`Waiting ${delay / 1000} seconds before checking migration status again.`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
}

async function downloadMigrationArchive(org: string, migrationId: number, filePath: string) {
    const octokit = new Octokit({
        auth: env.GITHUB_TOKEN,
        baseUrl: env.GITHUB_ENDPOINT
    });

    const { data } = await octokit.request('GET /orgs/{org}/migrations/{migration_id}/archive', {
        org: org,
        migration_id: migrationId
    })

    const fileStream = createWriteStream(filePath);
    fileStream.write(data);
    fileStream.end();
}

export function acceptCommandLineArgs(): { repos: { org: string, repo: string }[], endpoint: string, outdir: string } {
    const argv = yargs.default(process.argv.slice(2))
        .option('repos', {
            alias: 'r',
            description: 'Comma delimited list of orgs/repos (ex. github/github,torvalds/linux)',
            type: 'string',
            demandOption: true,
        })
        .option('endpoint', {
            alias: 'e',
            description: 'The api endpoint of the github instance (ex. api.github.com)',
            type: 'string',
            demandOption: true,
        }).option('outdir', {
            alias: 'o',
            description: 'The output directory for the files (ex. api.github.com)',
            type: 'string',
            default: "archives",
            demandOption: false,
        }).argv;
    let repoObjs: { org: string, repo: string }[] = [];
    argv.repos.split(",").forEach((repo: string) => {
        repoObjs.push({
            org: repo.split("/")[0].trim(),
            repo: repo.split("/")[1].trim()
        })
    });
    return { repos: repoObjs, endpoint: argv.endpoint, outdir: argv.outdir };
}