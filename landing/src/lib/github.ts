const repoApiUrl = "https://api.github.com/repos/callstackincubator/agent-device";

type GitHubRepoResponse = {
  stargazers_count?: number;
};

export type GitHubRepoStats = {
  stars: number;
};

export const githubRepoUrl = "https://github.com/callstackincubator/agent-device";

export async function getGitHubRepoStats(): Promise<GitHubRepoStats | null> {
  try {
    const token = process.env.GITHUB_TOKEN;
    const response = await fetch(repoApiUrl, {
      headers: {
        Accept: "application/vnd.github+json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      next: {
        revalidate: 60 * 60 * 4,
      },
    });

    if (!response.ok) {
      return null;
    }

    const repo = await response.json() as GitHubRepoResponse;

    if (typeof repo.stargazers_count !== "number") {
      return null;
    }

    return {
      stars: repo.stargazers_count,
    };
  } catch {
    return null;
  }
}

export function formatStarCount(stars: number) {
  if (stars >= 1_000_000) {
    return `${(stars / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }

  if (stars >= 1_000) {
    return `${(stars / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  }

  return new Intl.NumberFormat("en-US").format(stars);
}
