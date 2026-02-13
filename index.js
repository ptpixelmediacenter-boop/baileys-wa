const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const COOLIFY_URL = process.env.COOLIFY_URL;
const TOKEN = process.env.COOLIFY_TOKEN;

const PROJECT_ID = process.env.PROJECT_ID;
const ENV_ID = process.env.ENVIRONMENT_ID;
const DEST_ID = process.env.DESTINATION_ID;

const GIT_REPO = process.env.GIT_REPO;
const GIT_BRANCH = "main";

async function createApp(tenant) {
  const domain = `${tenant}.wa.pixelbot.web.id`;

  const response = await axios.post(
    `${COOLIFY_URL}/api/v1/applications`,
    {
      name: `wa-${tenant}`,
      project_uuid: PROJECT_ID,
      environment_uuid: ENV_ID,
      destination_uuid: DEST_ID,

      git_repository: GIT_REPO,
      git_branch: GIT_BRANCH,

      build_pack: "nixpacks",
      ports_exposes: "3000",

      domains: [domain],

      environment_variables: [
        { key: "PORT", value: "3000" },
        { key: "TENANT_ID", value: tenant },
        { key: "N8N_WEBHOOK", value: process.env.N8N_WEBHOOK }
      ]
    },
    {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );

  return {
    app: response.data,
    domain,
    qr_endpoint: `https://${domain}/qr/${tenant}`
  };
}

app.post("/create-tenant", async (req, res) => {
  try {
    const { tenant } = req.body;
    if (!tenant)
      return res.status(400).json({ error: "tenant required" });

    const result = await createApp(tenant);

    res.json({
      success: true,
      tenant,
      app_name: `wa-${tenant}`,
      domain: result.domain,
      qr_endpoint: result.qr_endpoint,
      message: "App created & deploying automatically"
    });
  } catch (err) {
    res.status(500).json({
      error: err.response?.data || err.message
    });
  }
});

app.listen(4000, () =>
  console.log("Auto Provisioner running")
);
