"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.acceptCommandLineArgs = exports.checkForGeiInstallation = exports.checkEnvVars = void 0;
const child_process_1 = require("child_process");
const process_1 = require("process");
// import yargs, {Argv} from "yargs";
const yargs = require('yargs');
function checkEnvVars() {
    if (process_1.env.GITHUB_TOKEN === undefined) {
        throw new Error("A GitHub token was not provided. Please set the GITHUB_TOKEN environment variable.");
    }
    if (process_1.env.GITHUB_ENDPOINT === undefined) {
        throw new Error("A GitHub endpoint was not provided. Please set the GITHUB_ENDPOINT environment variable.");
    }
    if (process_1.env.GITHUB_REPOS === undefined) {
        throw new Error("A GitHub repository was not provided. Please set the GITHUB_REPO environment variable.");
    }
    return;
}
exports.checkEnvVars = checkEnvVars;
function checkForGeiInstallation() {
    // run bash command and check for errors
    (0, child_process_1.exec)("gei --version", (error, stderr) => {
        if (error || stderr) {
            throw new Error("The gei command is not installed. Please install the gei command line tool and try again.");
        }
        else {
            console.log("GEI is installed correctly.");
        }
    });
}
exports.checkForGeiInstallation = checkForGeiInstallation;
function acceptCommandLineArgs() {
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
    let repoObjs = [];
    argv.repos.split(",").forEach((repo) => {
        repoObjs.push({
            org: repo.split("/")[0].trim(),
            repo: repo.split("/")[1].trim()
        });
    });
    return { repos: repoObjs, endpoint: argv.endpoint, outdir: argv.outdir };
}
exports.acceptCommandLineArgs = acceptCommandLineArgs;
