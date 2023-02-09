const github = require("@actions/github");
const core = require("@actions/core");
const exec = require("@actions/exec");

async function run() {
	try {
		const GITHUB_TOKEN = core.getInput("GITHUB_TOKEN");
		const octokit = github.getOctokit(GITHUB_TOKEN);

		if (github.context.eventName === "pull_request") {
			const payload = github.context.payload;

			const pull_number = payload.pull_request.number;
			const owner = github.context.repo.owner;
			const repo = github.context.repo.repo;

			const { data: commits } = await octokit.rest.pulls.listCommits({
				owner,
				repo,
				pull_number,
			});

			for (const commit of commits) {
				const { sha } = commit;

				let gitVerifyCommitOutput = "";
				let ykAttestVerifyOutput = "";

				// Run `git verify-commit` to get the signature information for the commit
				await exec.exec(`git verify-commit ${sha}`, [], {
					listeners: {
						stdout: (data) => {
							gitVerifyCommitOutput += data.toString();
						},
					},
				});

				// Extract the signature key fingerprint from the output of `git verify-commit`
				const gitVerifyCommitFingerprint =
					gitVerifyCommitOutput.match(/using RSA key (.*)/)[1];

				// Run `yk-attest-verify` to get the YubiKey OPGP attestation information
				await exec.exec(
					"yk-attest-verify pgp attestation.pem signer.pem --allowed-keysources=generated",
					[],
					{
						listeners: {
							stdout: (data) => {
								ykAttestVerifyOutput += data.toString();
							},
						},
					},
				);

				// Extract the YubiKey OPGP key fingerprint from the output of `yk-attest-verify`
				const ykAttestVerifyFingerprint = ykAttestVerifyOutput.match(
					/Key fingerprint: (.*)/,
				)[1];

				// Compare the extracted key fingerprints
				if (gitVerifyCommitFingerprint !== ykAttestVerifyFingerprint) {
					core.setFailed(
						`Commit ${sha} was signed with key fingerprint ${gitVerifyCommitFingerprint} but the YubiKey OPGP key fingerprint is ${ykAttestVerifyFingerprint}`,
					);
				}
			}

			core.info("All commits are signed with the expected key");
		} else {
			core.setFailed(
				`Action needs to be run on the "pull_request" event but was run on "${github.context.eventName}" instead`,
			);
		}
	} catch (error) {
		core.setFailed(error.message);
	}
}

run();
