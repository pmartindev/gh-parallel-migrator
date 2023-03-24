import { Octokit } from "@octokit/rest";
import dotenv from "dotenv"
import { createWriteStream, existsSync, mkdirSync } from "fs";
const yargs = require('yargs')


const main = async () => {
    dotenv.config();
    const { repos, endpoint, outdir, token } = acceptCommandLineArgs();
    await run(repos, endpoint, outdir, token);
};

// The main entrypoint for the application
main();

async function run(repos: any, endpoint: string, outdir: string, token: string) {
    const promises: any = [];
    if (!existsSync(outdir)) {
        mkdirSync(outdir, { recursive: true });
        console.log(`Created directory ${outdir}`);
      } else {
        console.log(`Directory ${outdir} already exists`);
      }
    repos.forEach((repo: any) => {
        promises.push(startOrgMigration(repo.org, repo.repo, endpoint, token));
    });
    const migrations: { org: string, migrationId: number }[] = await Promise.all(promises);
    console.log(migrations);
    await checkMigrationStatus(migrations, outdir, endpoint, token);
}

async function startOrgMigration(org: string, repo: string, endpoint: string, token: string) {
    const octokit = new Octokit({
        auth: token,
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

async function checkMigrationStatus(migrationIds: { org: string, migrationId: number }[], outdir: string, endpoint: string, token: string) {
    const octokit = new Octokit({
        auth: token,
        baseUrl: endpoint
    });

    const promises: any = [];
    migrationIds.forEach((migrationId: any) => {
        promises.push(checkSingleMigrationStatus(migrationId, outdir, octokit));
    });

    return Promise.all(promises).then((values) => {
        console.log(values);
    });
}

async function checkSingleMigrationStatus(migrationId: { org: string, migration_id: number }, outdir: string, octokit: Octokit) {
    let migrationStatus: string;
    let attempts = 0;
    const maxAttempts = 180;
    const delayInMilliseconds = 60 * 1000;
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
            const filePath = `${outdir}/migration_archive_${migrationId.migration_id}.tar.gz`;
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
                console.log(`Waiting ${delayInMilliseconds / 1000} seconds before checking migration status again.`);
                await new Promise(resolve => setTimeout(resolve, delayInMilliseconds));
            }
        }
    }
}

async function downloadMigrationArchive(org: string, migrationId: number, filePath: string, endpoint: string, token: string) {
    const octokit = new Octokit({
        auth: token,
        baseUrl: endpoint
    });

    const { data } = await octokit.request('GET /orgs/{org}/migrations/{migration_id}/archive', {
        org: org,
        migration_id: migrationId
    })

    const fileStream = createWriteStream(filePath);
    fileStream.write(data);
    fileStream.end();
}

export function acceptCommandLineArgs(): { repos: { org: string, repo: string }[], endpoint: string, outdir: string, token: string } {
    const argv = yargs.default(process.argv.slice(2))
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
        .option('token', {
            alias: 't',
            env: 'GITHUB_TOKEN',
            description: 'The personal access token for the GHES Migration API.',
            type: 'string',
            demandOption: true,
        }).argv;
    let repoObjs: { org: string, repo: string }[] = [];
    argv.repos.split(",").forEach((repo: string) => {
        repoObjs.push({
            org: repo.split("/")[0].trim(),
            repo: repo.split("/")[1].trim()
        })
    });
    return { repos: repoObjs, endpoint: argv.endpoint, outdir: argv.outdir, token: argv.token };
}
