export async function GET() {
  const script = `
(function () {
  var currentScript = document.currentScript;
  var tenant = currentScript && currentScript.getAttribute("data-tenant");
  if (!tenant || document.getElementById("odogwu-livechat-launcher")) return;
  var origin = "https://odogwuhq.com";
  try {
    origin = new URL(currentScript.src).origin;
  } catch (error) {}

  var launcher = document.createElement("a");
  launcher.id = "odogwu-livechat-launcher";
  launcher.href = origin + "/shop/" + encodeURIComponent(tenant);
  launcher.target = "_blank";
  launcher.rel = "noopener noreferrer";
  launcher.textContent = "Chat with us";
  launcher.style.position = "fixed";
  launcher.style.right = "18px";
  launcher.style.bottom = "18px";
  launcher.style.zIndex = "2147483647";
  launcher.style.padding = "12px 14px";
  launcher.style.borderRadius = "999px";
  launcher.style.border = "1px solid rgba(255,255,255,0.22)";
  launcher.style.background = "#111";
  launcher.style.color = "#fff";
  launcher.style.font = "600 14px/1.2 -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  launcher.style.textDecoration = "none";
  launcher.style.boxShadow = "0 12px 34px rgba(0,0,0,0.24)";
  document.body.appendChild(launcher);
})();`;

  return new Response(script.trim(), {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
