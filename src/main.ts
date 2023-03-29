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
    // Check if archive output dir already exists
    let message: string = `Directory ${outdir} already exists`
    if (!existsSync(outdir)) {
        mkdirSync(outdir, { recursive: true });
        message = `Created directory ${outdir}`
    }
    console.log(message)
    const octokit = new Octokit({
        auth: token,
        baseUrl: endpoint
    })
    repos.forEach((repo: any) => {
        promises.push(startOrgMigration(repo.org, repo.repo, octokit));
    });
    const migrations: { org: string, migrationId: number }[] = await Promise.all(promises);
    console.log(migrations);
    await checkMigrationStatus(migrations, outdir, octokit);
}

async function startOrgMigration(org: string, repo: string, octokit: Octokit) {
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

async function checkMigrationStatus(migrations: { org: string, migrationId: number }[], outdir: string, octokit: Octokit) {
    const promises: any = [];
    migrations.forEach((migration: any) => {
        promises.push(checkStatusAndArchiveDownload(migration, outdir, octokit));
    });

    return Promise.all(promises).then((values) => {
        console.log(values);
    });
}

async function checkStatusAndArchiveDownload(migration: { org: string, migration_id: number }, outdir: string, octokit: Octokit) {
    /**
     * 
     */
    let migrationStatus: string;
    let attempts = 0;
    const maxAttempts = 180;
    const delayInMilliseconds = 60 * 1000;
    while (true) {
        try {
            const response = await octokit.request(`GET /orgs/{org}/migrations/${migration.migration_id.toString()}`, {
                org: migration.org,
                migration_id: migration.migration_id
            });
            migrationStatus = response.data.state;
        } catch (error) {
            console.log(`ERROR: Failed to get status for migration ${migration.migration_id}.`);
            console.log(error);
            migrationStatus = "Unknown";
        }

        console.log(`Migration ${migration.migration_id} status: ${migrationStatus}.`);

        if (migrationStatus === "exported") {
            const filePath = `${outdir}/migration_archive_${migration.migration_id}.tar.gz`;
            console.log(`Migration ${migration.migration_id} is complete.`);
            console.log(`Downloading migration ${migration.migration_id} archive to ${filePath}.`)
            const response = await octokit.request<any>('GET /orgs/{org}/migrations/{migration_id}/archive', {
                org: migration.org,
                migration_id: migration.migration_id
            })
            const fileStream = createWriteStream(filePath);
            fileStream.write(Buffer.from(response.data));
            fileStream.end();
            console.log(`Migration ${migration.migration_id} archive downloaded to ${filePath}.`)
            return { migrationId: migration.migration_id, migrationStatus };
        } else if (migrationStatus === "failed") {
            console.log(`ERROR: Archive generation failed for migration ${migration.migration_id}.`);
            return { migrationId: migration.migration_id, migrationStatus };
        } else {
            attempts++;
            if (attempts >= maxAttempts) {
                console.log(`ERROR: Maximum number of attempts (${maxAttempts}) reached for migration ${migration.migration_id}.`);
                return { migrationId: migration.migration_id, migrationStatus };
            } else {
                console.log(`Waiting ${delayInMilliseconds / 1000} seconds before checking migration status again.`);
                await new Promise(resolve => setTimeout(resolve, delayInMilliseconds));
            }
        }
    }
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
