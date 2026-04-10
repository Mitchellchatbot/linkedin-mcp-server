import axios from "axios";

const LINKEDIN_API_BASE = "https://api.linkedin.com/v2";
const LINKEDIN_REST_BASE = "https://api.linkedin.com/rest";

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

export interface OrgPage {
  id: string;
  name: string;
  urn: string;
  vanityName?: string;
  logoUrl?: string;
}

export interface AdAccount {
  id: string;
  name: string;
  currency: string;
  status: string;
  urn: string;
}

export interface AdCampaign {
  id: string;
  name: string;
  status: string;
  type: string;
  totalBudget?: number;
  currency?: string;
}

export interface LinkedInEvent {
  id: string;
  name: string;
  startTime?: number;
  endTime?: number;
  description?: string;
  eventUrl?: string;
}

function authHeader(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}` };
}

function restHeaders(accessToken: string) {
  return {
    ...authHeader(accessToken),
    "LinkedIn-Version": "202504",
    "X-Restli-Protocol-Version": "2.0.0",
  };
}

// ── Profile ───────────────────────────────────────────────────────────────────

export async function getProfile(accessToken: string): Promise<LinkedInProfile> {
  const res = await axios.get(`${LINKEDIN_API_BASE}/userinfo`, {
    headers: authHeader(accessToken),
  });

  const d = res.data;
  const firstName = d.given_name || d.name?.split(" ")[0] || "";
  const lastName  = d.family_name || d.name?.split(" ").slice(1).join(" ") || "";

  return {
    id:             d.sub,
    firstName,
    lastName,
    headline:       undefined,
    profilePicture: d.picture,
    email:          d.email,
  };
}

// ── Create member post ────────────────────────────────────────────────────────

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

export async function getMyPosts(
  accessToken: string,
  authorUrn: string,
  count = 10
): Promise<LinkedInPost[]> {
  try {
    const encoded = encodeURIComponent(authorUrn);
    const res = await axios.get(
      `${LINKEDIN_REST_BASE}/posts?author=${encoded}&q=author&count=${count}&sortBy=LAST_MODIFIED`,
      { headers: restHeaders(accessToken) }
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
    if (restErr.response?.status !== 403) {
      console.error("[linkedin] REST posts error:", restErr.response?.data || restErr.message);
    }
  }

  // Fall back to ugcPosts
  try {
    const encoded = encodeURIComponent(authorUrn);
    const res = await axios.get(
      `${LINKEDIN_API_BASE}/ugcPosts?q=authors&authors=List(${encoded})&count=${count}`,
      { headers: restHeaders(accessToken) }
    );

    return (res.data.elements || []).map((el: any) => ({
      id: el.id,
      text: el.specificContent?.["com.linkedin.ugc.ShareContent"]?.shareCommentary?.text || "",
      createdAt: el.created?.time || 0,
    }));
  } catch (err: any) {
    if (err.response?.status === 403) {
      throw new Error(
        "Reading posts requires the r_member_social scope which is only granted to LinkedIn Marketing API partners."
      );
    }
    throw err;
  }
}

// ── Post comments ─────────────────────────────────────────────────────────────
// Requires r_organization_social

export async function getPostComments(
  accessToken: string,
  postUrn: string,
  count = 20
): Promise<{ id: string; actor: string; message: string; createdAt: number }[]> {
  const encoded = encodeURIComponent(postUrn);
  const res = await axios.get(
    `${LINKEDIN_REST_BASE}/socialActions/${encoded}/comments?count=${count}`,
    { headers: restHeaders(accessToken) }
  );

  return (res.data.elements || []).map((el: any) => ({
    id: el.id || "",
    actor: el.actor || "",
    message: el.message?.text || "",
    createdAt: el.created?.time || 0,
  }));
}

// ── Post reactions ────────────────────────────────────────────────────────────
// Requires r_organization_social

export async function getPostReactions(
  accessToken: string,
  postUrn: string,
  count = 50
): Promise<{ actor: string; reactionType: string }[]> {
  const encoded = encodeURIComponent(postUrn);
  const res = await axios.get(
    `${LINKEDIN_REST_BASE}/reactions/${encoded}?count=${count}`,
    { headers: restHeaders(accessToken) }
  );

  return (res.data.elements || []).map((el: any) => ({
    actor: el.actor || "",
    reactionType: el.reactionType || "LIKE",
  }));
}

// ── Post social stats (likes, comments, shares, impressions) ──────────────────
// Requires r_organization_social

export async function getPostSocialStats(
  accessToken: string,
  postUrns: string[]
): Promise<object[]> {
  const ids = postUrns.map(u => `List(${encodeURIComponent(u)})`).join("&ids=");
  const res = await axios.get(
    `${LINKEDIN_API_BASE}/socialMetadata?ids=List(${postUrns.map(encodeURIComponent).join(",")})`,
    {
      headers: {
        ...authHeader(accessToken),
        "X-Restli-Protocol-Version": "2.0.0",
      },
    }
  );

  return Object.values(res.data.results || {});
}

// ── Delete post ───────────────────────────────────────────────────────────────

export async function deletePost(accessToken: string, postId: string): Promise<void> {
  // postId may be a full URN or just the ID portion
  const id = postId.includes("urn:li:") ? encodeURIComponent(postId) : postId;
  await axios.delete(`${LINKEDIN_API_BASE}/ugcPosts/${id}`, {
    headers: {
      ...authHeader(accessToken),
      "X-Restli-Protocol-Version": "2.0.0",
    },
  });
}

// ── Organization pages ────────────────────────────────────────────────────────
// Requires rw_organization_admin or r_organization_admin

export async function getOrgPages(accessToken: string): Promise<OrgPage[]> {
  // organizationAcls requires LinkedIn Partner Program access beyond rw_organization_admin.
  // Guide the user to use linkedin_find_org instead.
  throw new Error(
    "Listing managed pages requires LinkedIn Partner Program access not available with standard developer apps. " +
    "Use linkedin_find_org_by_vanity_name instead — pass the slug from your company URL " +
    "(e.g. linkedin.com/company/YOUR-SLUG → pass 'YOUR-SLUG')."
  );
}

// ── Find org by vanity name ───────────────────────────────────────────────────

export async function findOrgByVanityName(
  accessToken: string,
  vanityName: string
): Promise<OrgPage> {
  const res = await axios.get(
    `${LINKEDIN_API_BASE}/organizations?q=vanityName&vanityName=${encodeURIComponent(vanityName)}`,
    { headers: restHeaders(accessToken) }
  );

  const org = res.data.elements?.[0] || res.data;
  const id = String(org.id || "");
  return {
    id,
    name: org.name?.localized?.en_US || org.localizedName || vanityName,
    urn: `urn:li:organization:${id}`,
    vanityName: org.vanityName,
  };
}

// ── Org posts ─────────────────────────────────────────────────────────────────
// Requires r_organization_social

export async function getOrgPosts(
  accessToken: string,
  orgUrn: string,
  count = 10
): Promise<LinkedInPost[]> {
  const encoded = encodeURIComponent(orgUrn);
  const res = await axios.get(
    `${LINKEDIN_REST_BASE}/posts?author=${encoded}&q=author&count=${count}&sortBy=LAST_MODIFIED`,
    { headers: restHeaders(accessToken) }
  );

  return (res.data.elements || []).map((el: any) => ({
    id: el.id,
    text: el.commentary || el.text?.text || "",
    createdAt: el.publishedAt || el.createdAt || 0,
  }));
}

// ── Create org post ───────────────────────────────────────────────────────────
// Requires w_organization_social

export async function createOrgPost(
  accessToken: string,
  orgUrn: string,
  text: string
): Promise<string> {
  const body = {
    author: orgUrn,
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

// ── Org follower analytics ────────────────────────────────────────────────────
// Requires r_organization_admin

export async function getOrgFollowerStats(
  accessToken: string,
  orgUrn: string
): Promise<object> {
  const encoded = encodeURIComponent(orgUrn);
  const res = await axios.get(
    `${LINKEDIN_API_BASE}/organizationalEntityFollowerStatistics?q=organizationalEntity&organizationalEntity=${encoded}`,
    {
      headers: {
        ...authHeader(accessToken),
        "X-Restli-Protocol-Version": "2.0.0",
      },
    }
  );
  return res.data.elements?.[0] || res.data;
}

// ── Org page statistics ───────────────────────────────────────────────────────
// Requires r_organization_admin

export async function getOrgPageStats(
  accessToken: string,
  orgUrn: string
): Promise<object> {
  const encoded = encodeURIComponent(orgUrn);
  const res = await axios.get(
    `${LINKEDIN_API_BASE}/organizationPageStatistics?q=organization&organization=${encoded}`,
    {
      headers: {
        ...authHeader(accessToken),
        "X-Restli-Protocol-Version": "2.0.0",
      },
    }
  );
  return res.data.elements?.[0] || res.data;
}

// ── Ad accounts ───────────────────────────────────────────────────────────────
// Requires r_ads

export async function getAdAccounts(accessToken: string): Promise<AdAccount[]> {
  const res = await axios.get(
    `${LINKEDIN_API_BASE}/adAccountsV2?q=search&search.type.values[0]=BUSINESS&search.status.values[0]=ACTIVE`,
    {
      headers: {
        ...authHeader(accessToken),
        "X-Restli-Protocol-Version": "2.0.0",
      },
    }
  );

  return (res.data.elements || []).map((el: any) => ({
    id: String(el.id),
    name: el.name || "",
    currency: el.currency || "",
    status: el.status || "",
    urn: `urn:li:sponsoredAccount:${el.id}`,
  }));
}

// ── Ad campaigns ──────────────────────────────────────────────────────────────
// Requires r_ads

export async function getAdCampaigns(
  accessToken: string,
  accountId: string,
  count = 20
): Promise<AdCampaign[]> {
  const accountUrn = encodeURIComponent(`urn:li:sponsoredAccount:${accountId}`);
  const res = await axios.get(
    `${LINKEDIN_API_BASE}/adCampaignsV2?q=search&search.account.values[0]=${accountUrn}&count=${count}`,
    {
      headers: {
        ...authHeader(accessToken),
        "X-Restli-Protocol-Version": "2.0.0",
      },
    }
  );

  return (res.data.elements || []).map((el: any) => ({
    id: String(el.id),
    name: el.name || "",
    status: el.status || "",
    type: el.type || "",
    totalBudget: el.totalBudget?.amount,
    currency: el.totalBudget?.currencyCode,
  }));
}

// ── Ad analytics ──────────────────────────────────────────────────────────────
// Requires r_ads_reporting

export async function getAdAnalytics(
  accessToken: string,
  accountId: string,
  startDate: string, // YYYY-MM-DD
  endDate: string    // YYYY-MM-DD
): Promise<object[]> {
  const [sy, sm, sd] = startDate.split("-").map(Number);
  const [ey, em, ed] = endDate.split("-").map(Number);
  const accountUrn = encodeURIComponent(`urn:li:sponsoredAccount:${accountId}`);

  const res = await axios.get(
    `${LINKEDIN_API_BASE}/adAnalyticsV2?q=analytics&pivot=CAMPAIGN&dateRange.start.year=${sy}&dateRange.start.month=${sm}&dateRange.start.day=${sd}&dateRange.end.year=${ey}&dateRange.end.month=${em}&dateRange.end.day=${ed}&timeGranularity=DAILY&accounts[0]=${accountUrn}&fields=impressions,clicks,costInLocalCurrency,externalWebsiteConversions,pivotValue`,
    {
      headers: {
        ...authHeader(accessToken),
        "X-Restli-Protocol-Version": "2.0.0",
      },
    }
  );

  return res.data.elements || [];
}

// ── Organization events ───────────────────────────────────────────────────────
// Requires r_events

export async function getOrgEvents(
  accessToken: string,
  orgUrn: string,
  count = 10
): Promise<LinkedInEvent[]> {
  const encoded = encodeURIComponent(orgUrn);
  const res = await axios.get(
    `${LINKEDIN_API_BASE}/organizerEvents?q=organizer&organizer=${encoded}&count=${count}`,
    {
      headers: {
        ...authHeader(accessToken),
        "X-Restli-Protocol-Version": "2.0.0",
      },
    }
  );

  return (res.data.elements || []).map((el: any) => ({
    id: String(el.id || el["ugcPost"] || ""),
    name: el.name?.localized?.en_US || el.name || "",
    startTime: el.startTime,
    endTime: el.endTime,
    description: el.description?.localized?.en_US || "",
    eventUrl: el.eventUrl,
  }));
}

// ── Create org event ──────────────────────────────────────────────────────────
// Requires rw_events

export async function createOrgEvent(
  accessToken: string,
  orgUrn: string,
  name: string,
  startTimeMs: number,
  endTimeMs: number,
  description?: string,
  timezone = "UTC"
): Promise<string> {
  const body: any = {
    organizer: orgUrn,
    name: { localized: { en_US: name } },
    startTime: startTimeMs,
    endTime: endTimeMs,
    eventAccessPolicy: "PUBLIC",
    ...(description && { description: { localized: { en_US: description } } }),
  };

  const res = await axios.post(`${LINKEDIN_API_BASE}/organizerEvents`, body, {
    headers: {
      ...authHeader(accessToken),
      "X-Restli-Protocol-Version": "2.0.0",
      "Content-Type": "application/json",
    },
  });

  return res.headers["x-restli-id"] || res.data?.id || "unknown";
}

// ── Connections count ─────────────────────────────────────────────────────────
// Requires r_1st_connections_size

export async function getConnectionsCount(
  accessToken: string,
  personUrn: string
): Promise<number> {
  const encoded = encodeURIComponent(personUrn);
  const res = await axios.get(
    `${LINKEDIN_API_BASE}/networkSizes/${encoded}?edgeType=CONNECTIONS_OF`,
    {
      headers: {
        ...authHeader(accessToken),
        "X-Restli-Protocol-Version": "2.0.0",
      },
    }
  );
  return res.data.firstDegreeSize || res.data.size || 0;
}

// ── Job search (partner only — kept as stub) ──────────────────────────────────

export async function searchJobs(
  _accessToken: string,
  _keywords: string,
  _location?: string,
  _count = 10
): Promise<JobSearchResult[]> {
  throw new Error(
    "Job search requires the r_jobs scope, which is only available to LinkedIn partner apps."
  );
}

// ── Connections list (partner only — kept as stub) ────────────────────────────

export async function getConnections(
  _accessToken: string,
  _count = 20
): Promise<{ id: string; firstName: string; lastName: string; headline?: string }[]> {
  throw new Error(
    "Reading connections list requires r_1st_3rd_connections, which is only available to LinkedIn partner apps."
  );
}

// ── People search (partner only — kept as stub) ───────────────────────────────

export async function searchPeople(
  _accessToken: string,
  _query: string,
  _count = 10
): Promise<{ id: string; name: string; headline?: string; company?: string }[]> {
  throw new Error(
    "People search requires elevated LinkedIn API access only available to partner apps."
  );
}
