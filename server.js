// NFLUENCE Score API — Railway deployment
// Env vars required: SORSA_API_KEY, ANTHROPIC_API_KEY

const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

// Serve frontend static files
app.use(express.static(path.join(__dirname, "public")));

const SORSA_API_KEY = process.env.SORSA_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "nfluence-score-api" });
});

// Sorsa proxy — fetch score + profile in parallel
app.get("/api/score/:handle", async (req, res) => {
  const { handle } = req.params;
  if (!handle || handle.length < 1) {
    return res.status(400).json({ error: "handle is required" });
  }
  if (!SORSA_API_KEY) {
    return res.status(500).json({ error: "SORSA_API_KEY not configured" });
  }

  try {
    const [scoreRes, profileRes] = await Promise.all([
      fetch(`https://api.sorsa.io/v2/score/${encodeURIComponent(handle)}`, {
        headers: { Accept: "application/json", ApiKey: SORSA_API_KEY },
      }),
      fetch(`https://api.sorsa.io/v3/info?username=${encodeURIComponent(handle)}`, {
        headers: { Accept: "application/json", ApiKey: SORSA_API_KEY },
      }),
    ]);

    const scoreData   = scoreRes.ok   ? await scoreRes.json()   : {};
    const profileData = profileRes.ok ? await profileRes.json() : {};

    console.log("Score:", JSON.stringify(scoreData));
    console.log("Profile:", JSON.stringify(profileData));

    const combined = {
      score:            scoreData.score            || 0,
      followers_count:  profileData.followers_count || 0,
      followings_count: profileData.followings_count || 0,
      tweets_count:     profileData.tweets_count    || 0,
      favourites_count: profileData.favourites_count || 0,
      display_name:     profileData.display_name    || handle,
      description:      profileData.description     || "",
      profile_image_url: profileData.profile_image_url || "",
      location:         profileData.location        || "",
      verified:         profileData.verified        || false,
    };

    res.json(combined);
  } catch (err) {
    console.error("Sorsa fetch error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Claude proxy — AI analysis
app.post("/api/analyze", async (req, res) => {
  const { handle, scores, profile } = req.body;

  if (!handle || !scores) {
    return res.status(400).json({ error: "handle and scores required" });
  }
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
  }

  const tier =
    scores.overall >= 90 ? "VIRTUOSO" :
    scores.overall >= 75 ? "AUTHORITY" :
    scores.overall >= 60 ? "SPECIALIST" :
    scores.overall >= 45 ? "AUTHOR" :
    scores.overall >= 30 ? "CONTRIBUTOR" : "OBSERVER";

  const prompt = `you are NFLUENCE, a crypto twitter influence analyzer. analyze this profile and give a short, punchy analysis in 3-4 sentences. be direct, use CT slang naturally. don't be generic — reference the actual numbers.

handle: @${handle}
sorsa score: ${profile?.score || "N/A"} (out of 2000)
followers: ${profile?.followers_count?.toLocaleString() || "N/A"}
following: ${profile?.followings_count?.toLocaleString() || "N/A"}
tweets: ${profile?.tweets_count?.toLocaleString() || "N/A"}
bio: ${profile?.description || "N/A"}
nfluence score: ${scores.overall}/100
tier: ${tier}
reach: ${scores.reach} | engagement: ${scores.engagement} | authority: ${scores.authority} | consistency: ${scores.consistency} | virality: ${scores.virality}

write in lowercase, short punchy lines. no bullet points. no markdown. be specific and savage.`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("Claude API error:", err);
      return res.status(500).json({ error: "Claude API failed" });
    }

    const data = await response.json();
    const text = data.content?.map((c) => c.text || "").join("") || "";
    res.json({ analysis: text });
  } catch (err) {
    console.error("Claude fetch error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Catch-all — serve frontend
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`NFLUENCE Score API running on port ${PORT}`);
});
