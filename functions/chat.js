// EdgeOne Pages 边缘函数 - 扣子编程项目 API 中转
// 部署后访问路径为 /chat
//
// ⚠️ 使用前必须先在 EdgeOne 项目的"环境变量"里配置：
//    - COZE_TOKEN     : 你的扣子编程项目 API Token（在部署页右上角"API Token"按钮里生成）
//    - COZE_ENDPOINT  : 你的项目专属域名，例如 https://qqzqm2qrjr.coze.site/stream_run
//    - PROJECT_ID     : 你的项目 ID（数字，例如 7641240317169205263）

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

    // 调扣子编程的 stream_run API
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

    // 解析 SSE 流：一行一行读取，累积所有 answer 事件的文本
    const reader = cozeResponse.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullAnswer = "";
    let errorMsg = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE 按 \n\n 分块
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() || "";

      for (const chunk of chunks) {
        const lines = chunk.split("\n");
        let eventType = "";
        let dataLine = "";

        for (const line of lines) {
          if (line.startsWith("event:")) {
            eventType = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            dataLine = line.slice(5).trim();
          }
        }

        if (!dataLine || dataLine === "[DONE]") continue;

        try {
          const parsed = JSON.parse(dataLine);

          if (eventType === "answer" || parsed.event === "answer") {
            const content = parsed.data?.content
                         || parsed.content
                         || parsed.data?.message
                         || "";
            if (typeof content === "string") {
              fullAnswer += content;
            } else if (content && typeof content === "object") {
              fullAnswer += content.text || JSON.stringify(content);
            }
          }

          if (eventType === "error" || parsed.event === "error") {
            errorMsg = parsed.data?.message || parsed.message || JSON.stringify(parsed);
          }
        } catch (e) {
          // 这一行解析失败就跳过
        }
      }
    }

    if (errorMsg) {
      return new Response(
        JSON.stringify({ reply: "扣子返回错误：" + errorMsg }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ reply: fullAnswer || "（智能体没有返回内容）" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ reply: "出错了：" + err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}
