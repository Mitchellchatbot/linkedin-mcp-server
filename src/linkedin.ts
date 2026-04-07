import axios from "axios";

const LINKEDIN_API_BASE = "https://api.linkedin.com/v2";

export interface LinkedInProfile {
  id: string;
  firstName: string;
  lastName: string;
  headline?: string;
  profilePicture?: string;
  email?: string;
}

export interface LinkedInPost {
  id: string;
  text: string;
  createdAt: number;
}

export interface JobSearchResult {
  id: string;
  title: string;
  company: string;
  location: string;
  url: string;
  postedAt?: string;
}

function authHeader(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}` };
}

// ── Profile ───────────────────────────────────────────────────────────────────
// Uses the OpenID Connect /v2/userinfo endpoint — works with the
// "Sign In with LinkedIn using OpenID Connect" product (openid + profile + email scopes).
// The legacy /v2/me endpoint requires r_liteprofile which is no longer available.

export async function getProfile(accessToken: string): Promise<LinkedInProfile> {
  const res = await axios.get(`${LINKEDIN_API_BASE}/userinfo`, {
    headers: authHeader(accessToken),
  });

  const d = res.data;
  // OIDC returns: sub, name, given_name, family_name, picture, email
  const firstName = d.given_name || d.name?.split(" ")[0] || "";
  const lastName  = d.family_name || d.name?.split(" ").slice(1).join(" ") || "";

  return {
    id:             d.sub,
    firstName,
    lastName,
    headline:       undefined, // Not available via OIDC basic scopes
    profilePicture: d.picture,
    email:          d.email,
  };
}

// ── Create post ───────────────────────────────────────────────────────────────
// Requires w_member_social scope ("Share on LinkedIn" product).

export async function createPost(
  accessToken: string,
  text: string,
  authorUrn: string
): Promise<string> {
  const body = {
    author: authorUrn,
    lifecycleState: "PUBLISHED",
    specificContent: {
      "com.linkedin.ugc.ShareContent": {
        shareCommentary: { text },
        shareMediaCategory: "NONE",
      },
    },
    visibility: {
      "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
    },
  };

  const res = await axios.post(`${LINKEDIN_API_BASE}/ugcPosts`, body, {
    headers: {
      ...authHeader(accessToken),
      "X-Restli-Protocol-Version": "2.0.0",
      "Content-Type": "application/json",
    },
  });

  return res.headers["x-restli-id"] || res.data?.id || "unknown";
}

// ── Get my posts ──────────────────────────────────────────────────────────────
// Try the newer REST Posts API first (202401), then fall back to ugcPosts.
// Both require w_member_social; reading may still 403 on non-partner apps.

export async function getMyPosts(
  accessToken: string,
  authorUrn: string,
  count = 10
): Promise<LinkedInPost[]> {
  // 1️⃣ Try the newer /rest/posts endpoint (LinkedIn-Version 202401)
  try {
    const encoded = encodeURIComponent(authorUrn);
    const res = await axios.get(
      `https://api.linkedin.com/rest/posts?author=${encoded}&q=author&count=${count}&sortBy=LAST_MODIFIED`,
      {
        headers: {
          ...authHeader(accessToken),
          "LinkedIn-Version": "202401",
          "X-Restli-Protocol-Version": "2.0.0",
        },
      }
    );

    const elements = res.data.elements || [];
    if (elements.length > 0) {
      return elements.map((el: any) => ({
        id: el.id,
        text: el.commentary || el.text?.text || "",
        createdAt: el.publishedAt || el.createdAt || 0,
      }));
    }
  } catch (restErr: any) {
    // If it's not a 403 bubble it up, otherwise fall through to ugcPosts
    if (restErr.response?.status !== 403) {
      console.error("[linkedin] REST posts error:", restErr.response?.data || restErr.message);
    }
  }

  // 2️⃣ Fall back to ugcPosts API
  try {
    const encoded = encodeURIComponent(authorUrn);
    const res = await axios.get(
      `${LINKEDIN_API_BASE}/ugcPosts?q=authors&authors=List(${encoded})&count=${count}`,
      {
        headers: {
          ...authHeader(accessToken),
          "X-Restli-Protocol-Version": "2.0.0",
          "LinkedIn-Version": "202401",
        },
      }
    );

    return (res.data.elements || []).map((el: any) => ({
      id: el.id,
      text:
        el.specificContent?.["com.linkedin.ugc.ShareContent"]
          ?.shareCommentary?.text || "",
      createdAt: el.created?.time || 0,
    }));
  } catch (err: any) {
    if (err.response?.status === 403) {
      throw new Error(
        "LinkedIn's API does not allow reading posts for standard developer apps — " +
        "this requires the r_member_social scope which is only granted to LinkedIn Marketing API partners. " +
        "You can still CREATE posts with this integration."
      );
    }
    throw err;
  }
}

// ── Job search ────────────────────────────────────────────────────────────────
// Requires r_jobs scope — only available to LinkedIn partner apps.

export async function searchJobs(
  _accessToken: string,
  _keywords: string,
  _location?: string,
  _count = 10
): Promise<JobSearchResult[]> {
  throw new Error(
    "Job search requires the r_jobs scope, which is only available to LinkedIn partner apps. " +
    "This feature is not accessible with a standard LinkedIn developer app."
  );
}

// ── Connections ───────────────────────────────────────────────────────────────
// Requires r_1st_3rd_connections — LinkedIn partner only.

export async function getConnections(
  _accessToken: string,
  _count = 20
): Promise<{ id: string; firstName: string; lastName: string; headline?: string }[]> {
  throw new Error(
    "Reading connections requires the r_1st_3rd_connections scope, which is only available to LinkedIn partner apps. " +
    "This feature is not accessible with a standard LinkedIn developer app."
  );
}

// ── People search ─────────────────────────────────────────────────────────────
// Requires r_1st_3rd_connections or elevated partner access.

export async function searchPeople(
  _accessToken: string,
  _query: string,
  _count = 10
): Promise<{ id: string; name: string; headline?: string; company?: string }[]> {
  throw new Error(
    "People search requires elevated LinkedIn API access only available to partner apps. " +
    "This feature is not accessible with a standard LinkedIn developer app."
  );
}
