import { exec } from "child_process";
import { env } from "process";
const yargs = require('yargs');
import logger from './logger';

export function checkEnvVars() {
    if (env.GITHUB_TOKEN === undefined) {
        throw new Error("A GitHub token was not provided. Please set the GITHUB_TOKEN environment variable.")
    }
    if (env.GITHUB_ENDPOINT === undefined) {
        throw new Error("A GitHub endpoint was not provided. Please set the GITHUB_ENDPOINT environment variable.")
    }
    if (env.GITHUB_REPOS === undefined) {
        throw new Error("A GitHub repository was not provided. Please set the GITHUB_REPO environment variable.")
    }
    return
}

export function checkForGeiInstallation() {
    // run bash command and check for errors
    exec("gei --version", (error, stderr) => {
        if (error || stderr) {
            throw new Error("The gei command is not installed. Please install the gei command line tool and try again.")
        } else {
            logger.info("GEI is installed correctly.")
        }
    });
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