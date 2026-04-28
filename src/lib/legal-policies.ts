export type LegalPolicySection = {
  heading: string;
  body: string[];
};

export type LegalPolicy = {
  title: string;
  updatedLabel: string;
  intro: string[];
  sections: LegalPolicySection[];
};

const updatedLabel = "Last updated: April 28, 2026";

export const LEGAL_POLICY_VERSIONS = {
  privacyPolicy: "2026-04-28",
  terms: "2026-04-28",
} as const;

export const privacyPolicy: LegalPolicy = {
  title: "Privacy Policy",
  updatedLabel,
  intro: [
    "This Privacy Policy explains how OdogwuHQ handles information when you use the private desktop console, hosted service, self-hosted mode, WhatsApp and Instagram setup, AI features, billing, and admin tools.",
  ],
  sections: [
    {
      heading: "What OdogwuHQ Processes",
      body: [
        "OdogwuHQ is an AI communication double for WhatsApp and Instagram. To run the product, it may process setup details such as your email, display name, device ID, service mode, PIN configuration, channel preferences, quiet hours, autonomy mode, mimicry settings, AI provider settings, and optional profile details used to shape the assistant's voice.",
        "When you connect WhatsApp or Instagram, OdogwuHQ may process message text, thread identifiers, contact or account labels, usernames, masked phone numbers, group status, reactions, captions, timestamps, media references, draft replies, sent-message records, follow-ups, todos, rules, guardrails, and worker or delivery status.",
      ],
    },
    {
      heading: "Local Data and Sessions",
      body: [
        "The desktop console stores local runtime state under the configured data directory, commonly .slm. This may include instance setup state, local PIN records, unlock/session secrets, encrypted connector-token material, and optional soul profile markdown. WhatsApp and Instagram login sessions may be stored in local auth directories such as .wa_auth and .ig_auth unless you configure different paths.",
        "You are responsible for protecting the device where OdogwuHQ runs, local auth folders, environment files, provider keys, backups, and logs. Anyone with access to those materials may be able to read messages, control the connector, or access the console.",
      ],
    },
    {
      heading: "Backend, Hosted Mode, and Admin Access",
      body: [
        "OdogwuHQ uses Convex to store application state such as tenants, devices, connected accounts, messages, threads, drafts, outbox items, settings, rules, media records, follow-ups, todos, provider runs, tool runs, system events, billing records, and admin records.",
        "In hosted mode, OdogwuHQ-managed backend infrastructure stores and processes tenant data so the desktop connector, dashboard, billing, and admin features can work. In self-hosted mode, your configured Convex deployment and related infrastructure are the backend for your instance.",
        "Authorized admins may access admin features for legitimate operations, including tenant management, subscription and entitlement handling, managed secrets, provider readiness, audit events, spending views, system health, and tenant-context support where enabled.",
      ],
    },
    {
      heading: "AI Providers and Generated Data",
      body: [
        "OdogwuHQ sends relevant prompts, conversation context, profile fields marked usable for AI, media context, and operational metadata to configured AI providers when needed to draft replies, classify context, generate media, transcribe or generate voice notes, run guardrails, or improve assistant behavior.",
        "Managed deployments may use Azure AI, OpenAI-compatible providers, image or video generation endpoints, local embeddings, Codex fallback generation, whisper.cpp, VoxCPM, or similar configured tools. Provider traces may record model names, latency, status, token usage, estimated cost, and errors.",
        "In self-hosted mode, you choose the Convex URL, app URL, AI base URL, AI API key, and model. Your chosen providers may receive the data needed to perform enabled features, and their own terms and privacy practices apply.",
      ],
    },
    {
      heading: "Billing and Third Parties",
      body: [
        "For hosted accounts, OdogwuHQ may store trial dates, billing status, plan, subscription period, checkout references, payment plan IDs, transaction references, subscription events, and tenant report metadata. If Flutterwave billing is enabled, payment checkout and verification data is exchanged with Flutterwave; OdogwuHQ does not need to store full card details.",
        "OdogwuHQ also interacts with services you connect or configure, including WhatsApp, Instagram, Convex, Azure AI or OpenAI-compatible providers, Flutterwave, Resend, Codex CLI, local ML tools, and optional search or connector providers. Those services process data under their own terms and privacy practices.",
      ],
    },
    {
      heading: "How Data Is Used",
      body: [
        "OdogwuHQ uses data to run the dashboard, connect channels, ingest and understand conversations, generate and queue drafts, send approved or automated messages, enforce rules, pause or resume autonomy, manage follow-ups, create todos, handle media, secure sessions, process billing, troubleshoot errors, estimate AI spend, and maintain the worker runtime.",
        "OdogwuHQ does not sell your personal data. Data is shared only as needed to operate the product, use configured providers, process payments, comply with law, protect the product, or support an authorized deployment.",
      ],
    },
    {
      heading: "Retention, Security, and Choices",
      body: [
        "OdogwuHQ keeps local and backend data for as long as needed to provide the product, preserve conversation context, operate billing and admin features, maintain logs, troubleshoot issues, meet legal or accounting obligations, and protect security.",
        "You can pause autonomy, require review, reject or snooze drafts, disconnect channels, rotate credentials, change AI providers, choose self-hosted mode, remove local data or auth folders, and control which soul profile fields may be used by AI. Hosted tenant, billing, audit, or provider records may require authorized admin handling and may be retained where required.",
        "OdogwuHQ uses controls such as PIN-based local security, signed session cookies, hashed connector tokens, encrypted managed secrets, same-origin checks for sensitive admin actions, and tenant scoping in supported hosted flows, but no system can guarantee perfect security.",
      ],
    },
    {
      heading: "Contact",
      body: [
        "For privacy questions, data access or deletion requests, billing support, or security concerns, contact the OdogwuHQ operator or support channel responsible for your deployment.",
      ],
    },
  ],
};

export const termsAndConditions: LegalPolicy = {
  title: "Terms and Conditions",
  updatedLabel,
  intro: [
    "These Terms govern access to and use of OdogwuHQ, including the desktop console, hosted backend, self-hosted mode, WhatsApp and Instagram connectors, AI features, billing flows, and admin tools.",
  ],
  sections: [
    {
      heading: "Using OdogwuHQ",
      body: [
        "OdogwuHQ helps monitor WhatsApp and Instagram conversations, draft replies in your style, maintain follow-ups, manage media and status workflows, and send messages when the configured mode and controls allow it. OdogwuHQ is not WhatsApp, Instagram, Meta, Convex, Flutterwave, Azure, OpenAI, or any other third-party provider.",
        "You must provide accurate setup information, keep control of your email, device, local PIN, social accounts, provider credentials, and billing account, and comply with the laws and platform rules that apply to your messages and connected accounts.",
      ],
    },
    {
      heading: "Accounts, Hosting, and Admins",
      body: [
        "Hosted mode may create a tenant account, device record, connector token, trial period, tenant session, and billing status in the OdogwuHQ backend. Hosted access may be limited by trial status, subscription status, entitlements, abuse prevention, maintenance, or security requirements.",
        "Self-hosted mode requires you to provide and maintain your own Convex deployment, app URL, AI endpoint, API key, model, backups, updates, monitoring, logs, provider costs, and compliance controls.",
        "Admin features may include tenant management, access management, managed secrets, subscriptions, billing events, platform configuration, provider readiness, audit feeds, spending views, system health, and tenant masquerade where enabled. Admins must use these features only for legitimate operations, support, security, and account management.",
      ],
    },
    {
      heading: "Acceptable Use",
      body: [
        "Use OdogwuHQ only with accounts, conversations, and data you are authorized to access. Do not use it to impersonate someone without authorization, harass people, send spam, violate platform rules, scrape data unlawfully, bypass consent, or automate unlawful or abusive activity.",
        "Do not disrupt the product, extract secrets, defeat tenant isolation, abuse the API gateway, overload connected services, reverse engineer restricted hosted services except where allowed by license, or use OdogwuHQ to generate or distribute harmful content.",
      ],
    },
    {
      heading: "AI and Messaging Responsibility",
      body: [
        "AI outputs may be incomplete, inaccurate, delayed, offensive, or inconsistent with your intent. Review queues, rules, guardrails, quiet hours, per-thread settings, and pause controls reduce risk but do not replace human judgment.",
        "You are responsible for messages drafted, approved, or sent by your instance, including activity in autopilot mode. Do not rely on OdogwuHQ for emergency communication, legal advice, medical advice, financial advice, therapy, or any high-stakes decision.",
        "WhatsApp and Instagram may limit, suspend, or terminate accounts for automation, unusual activity, policy violations, or other reasons. OdogwuHQ cannot guarantee connected-account availability or message delivery.",
      ],
    },
    {
      heading: "Credentials and Security",
      body: [
        "You must protect local auth directories, the .slm data directory, environment variables, API keys, connector tokens, PINs, admin credentials, and social account sessions. Do not share console access with anyone who should not read your messages or control your accounts.",
        "If a credential, social session, tenant account, provider key, or admin account may be compromised, rotate secrets, disconnect affected channels, pause workers, revoke access where available, and notify the operator for your deployment.",
      ],
    },
    {
      heading: "Billing and Subscriptions",
      body: [
        "Hosted plans may include a trial followed by a paid subscription. Billing status may be trialing, active, past due, paused, canceled, or another status shown in the product. When access expires or payment fails, hosted features may be paused or limited.",
        "If Flutterwave checkout is enabled, payment processing, renewal, verification, and related billing communications may be handled through Flutterwave. Prices, plans, trial lengths, grace periods, entitlements, and supported features may change unless a separate written agreement says otherwise.",
      ],
    },
    {
      heading: "Ownership and License",
      body: [
        "OdogwuHQ, including its software, product design, workflows, documentation, and hosted admin or billing internals, is proprietary unless a separate written license says otherwise. You receive only the rights needed to use the product as authorized.",
        "You retain responsibility for your messages, account content, profile information, media, configuration, and data you bring to the product. You grant OdogwuHQ the permissions needed to host, process, transmit, display, analyze, and transform that data solely to provide and operate the product.",
      ],
    },
    {
      heading: "Availability, Disclaimers, and Liability",
      body: [
        "OdogwuHQ may change, suspend, or discontinue features, providers, models, admin tools, pricing, or integrations. The product may be unavailable during maintenance, provider outages, local machine sleep, expired social sessions, billing pauses, Convex issues, or other operational events.",
        "OdogwuHQ is provided as available and as configured for your deployment. To the fullest extent permitted by law, OdogwuHQ disclaims implied warranties and is not liable for indirect, incidental, special, consequential, exemplary, or punitive damages, lost profits, lost data, lost goodwill, account restrictions, message delivery failures, provider outages, or AI-generated mistakes.",
        "Where liability cannot be excluded, liability is limited to the amount paid for the product during the period allowed by applicable law or the minimum amount required by law, unless a separate written agreement states otherwise.",
      ],
    },
    {
      heading: "Suspension, Termination, and Updates",
      body: [
        "Access may be suspended or terminated if billing is past due, a trial expires, credentials are compromised, use creates security or abuse risk, platform rules are violated, these Terms are breached, or continued operation could harm OdogwuHQ, users, connected platforms, or third parties.",
        "You may stop using OdogwuHQ by disconnecting channels, stopping workers, deleting local setup data, canceling hosted subscriptions where available, and requesting hosted tenant handling from the operator for your deployment.",
        "OdogwuHQ may update these Terms and the Privacy Policy as the product, providers, billing model, or legal requirements change. Continued use after updated terms are made available means you accept the updated terms unless a separate written agreement provides a different process.",
      ],
    },
    {
      heading: "Contact",
      body: [
        "For support, billing questions, security issues, data requests, or questions about these Terms, contact the OdogwuHQ operator or support channel responsible for your deployment.",
      ],
    },
  ],
};
