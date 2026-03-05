const test = async () => {
  const accessToken = "GITHUB_ACCESS_TOKEN";
  const userRes = await fetch("https://api.github.com/user", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  console.log(userRes.status);
};
