// EdgeOne Pages 边缘函数 - 扣子编程项目 API 中转（调试版）
// 这一版会把扣子返回的原始 SSE 流前 4000 字符显示出来，方便排查

export async function onRequest({ request, env }) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return new Response(
      JSON.stringify({ reply: "只支持 POST 请求" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const body = await request.json();
    const userMessage = body.message || "";
    const userId = body.user_id || "user_" + Date.now();

    const COZE_TOKEN    = env.COZE_TOKEN;
    const COZE_ENDPOINT = env.COZE_ENDPOINT;
    const PROJECT_ID    = env.PROJECT_ID;

    if (!COZE_TOKEN || !COZE_ENDPOINT || !PROJECT_ID) {
      return new Response(
        JSON.stringify({ reply: "⚠️ 边缘函数未配置 COZE_TOKEN / COZE_ENDPOINT / PROJECT_ID 环境变量" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const cozeResponse = await fetch(COZE_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + COZE_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: {
          query: {
            prompt: [
              {
                type: "text",
                content: { text: userMessage },
              },
            ],
          },
        },
        type: "query",
        session_id: userId,
        project_id: Number(PROJECT_ID),
      }),
    });

    if (!cozeResponse.ok) {
      const errText = await cozeResponse.text();
      return new Response(
        JSON.stringify({ reply: `扣子 API 错误 (${cozeResponse.status}): ${errText}` }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ⭐ 调试版：把所有原始内容读出来直接返回
    const rawText = await cozeResponse.text();

    return new Response(
      JSON.stringify({
        reply: "【调试模式 · 原始响应】\n\n" + rawText.slice(0, 4000)
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ reply: "出错了：" + err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}
