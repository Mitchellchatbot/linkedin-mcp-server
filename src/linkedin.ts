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

function headers(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "X-Restli-Protocol-Version": "2.0.0",
    "LinkedIn-Version": "202401",
  };
}

export async function getProfile(accessToken: string): Promise<LinkedInProfile> {
  const [profileRes, emailRes] = await Promise.allSettled([
    axios.get(
      `${LINKEDIN_API_BASE}/me?projection=(id,firstName,lastName,headline,profilePicture(displayImage~:playableStreams))`,
      { headers: headers(accessToken) }
    ),
    axios.get(
      `${LINKEDIN_API_BASE}/emailAddress?q=members&projection=(elements*(handle~))`,
      { headers: headers(accessToken) }
    ),
  ]);

  if (profileRes.status === "rejected") {
    throw new Error(`Failed to get profile: ${profileRes.reason?.message}`);
  }

  const p = profileRes.value.data;
  const firstName =
    p.firstName?.localized?.en_US ||
    Object.values(p.firstName?.localized || {})[0] ||
    "";
  const lastName =
    p.lastName?.localized?.en_US ||
    Object.values(p.lastName?.localized || {})[0] ||
    "";

  let profilePicture: string | undefined;
  try {
    const elements =
      p.profilePicture?.["displayImage~"]?.elements;
    if (elements?.length) {
      profilePicture =
        elements[elements.length - 1]?.identifiers?.[0]?.identifier;
    }
  } catch {}

  let email: string | undefined;
  if (emailRes.status === "fulfilled") {
    try {
      email =
        emailRes.value.data.elements?.[0]?.["handle~"]?.emailAddress;
    } catch {}
  }

  return {
    id: p.id,
    firstName: String(firstName),
    lastName: String(lastName),
    headline: p.headline?.localized?.en_US || Object.values(p.headline?.localized || {})[0] as string | undefined,
    profilePicture,
    email,
  };
}

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
    headers: headers(accessToken),
  });

  return res.headers["x-restli-id"] || res.data?.id || "unknown";
}

export async function getMyPosts(
  accessToken: string,
  authorUrn: string,
  count = 10
): Promise<LinkedInPost[]> {
  const encoded = encodeURIComponent(authorUrn);
  const res = await axios.get(
    `${LINKEDIN_API_BASE}/ugcPosts?q=authors&authors=List(${encoded})&count=${count}`,
    { headers: headers(accessToken) }
  );

  return (res.data.elements || []).map((el: any) => ({
    id: el.id,
    text:
      el.specificContent?.["com.linkedin.ugc.ShareContent"]
        ?.shareCommentary?.text || "",
    createdAt: el.created?.time || 0,
  }));
}

export async function searchJobs(
  accessToken: string,
  keywords: string,
  location?: string,
  count = 10
): Promise<JobSearchResult[]> {
  const params: Record<string, string | number> = {
    keywords,
    count,
  };
  if (location) params.location = location;

  try {
    const res = await axios.get(`${LINKEDIN_API_BASE}/jobSearch`, {
      headers: headers(accessToken),
      params,
    });

    return (res.data.elements || []).map((el: any) => ({
      id: el.entityUrn || el.id,
      title: el.title || "",
      company: el.companyName || "",
      location: el.formattedLocation || "",
      url: el.applyMethod?.companyApplyUrl || `https://www.linkedin.com/jobs/view/${el.id}`,
      postedAt: el.listedAt ? new Date(el.listedAt).toISOString() : undefined,
    }));
  } catch (err: any) {
    // Job search API has limited access — surface a helpful message
    throw new Error(
      `Job search requires r_jobs scope. LinkedIn API error: ${err.response?.data?.message || err.message}`
    );
  }
}

export async function getConnections(
  accessToken: string,
  count = 20
): Promise<{ id: string; firstName: string; lastName: string; headline?: string }[]> {
  const res = await axios.get(
    `${LINKEDIN_API_BASE}/connections?q=viewer&projection=(elements*(miniProfile(id,firstName,lastName,occupation)))&count=${count}`,
    { headers: headers(accessToken) }
  );

  return (res.data.elements || []).map((el: any) => {
    const mp = el.miniProfile || {};
    return {
      id: mp.id,
      firstName: mp.firstName || "",
      lastName: mp.lastName || "",
      headline: mp.occupation,
    };
  });
}

export async function searchPeople(
  accessToken: string,
  query: string,
  count = 10
): Promise<{ id: string; name: string; headline?: string; company?: string }[]> {
  const res = await axios.get(
    `${LINKEDIN_API_BASE}/search?q=people&keywords=${encodeURIComponent(query)}&count=${count}`,
    { headers: headers(accessToken) }
  );

  return (res.data.elements || []).map((el: any) => ({
    id: el.targetUrn || el.id,
    name: el.title?.text || "",
    headline: el.primarySubtitle?.text,
    company: el.secondarySubtitle?.text,
  }));
}
