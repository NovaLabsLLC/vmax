/**
 * Linear GraphQL (https://linear.app/developers/graphql)
 * Auth: Authorization header = raw API key (no Bearer prefix).
 */

async function linearGraphql(apiKey, query, variables = {}) {
  const key = String(apiKey || "").trim();
  if (!key) throw new Error("Missing Linear API key");

  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: key,
    },
    body: JSON.stringify({ query, variables }),
  });

  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error(`Linear response not JSON (HTTP ${res.status})`);
  }

  if (json.errors?.length) {
    const msg = json.errors.map((e) => e.message).filter(Boolean).join("; ");
    throw new Error(msg || "Linear GraphQL error");
  }

  if (!res.ok) {
    throw new Error(`Linear HTTP ${res.status}`);
  }

  return json.data;
}

/** Validates key and returns viewer info. */
async function verifyLinearApiKey(apiKey) {
  const query = `query VerifyLinearViewer { viewer { id name displayName email } }`;
  const data = await linearGraphql(apiKey, query);
  const v = data?.viewer;
  return {
    ok: true,
    userName: v?.name || v?.displayName || "",
    email: v?.email || "",
  };
}

module.exports = { verifyLinearApiKey, linearGraphql };
