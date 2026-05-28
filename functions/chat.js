// EdgeOne Pages 边缘函数 - 扣子编程项目 API 中转（流式版 v2，修复长内容 network error）
// 部署后访问路径为 /chat
//
// ⚠️ 必须在 EdgeOne 项目"环境变量"里配置：
//    - COZE_TOKEN     : 扣子编程项目 API Token
//    - COZE_ENDPOINT  : 项目专属域名，例如 https://qqzqm2qrjr.coze.site/stream_run
//    - PROJECT_ID     : 项目 ID（纯数字）

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
    return new Response("只支持 POST 请求", { status: 405, headers: corsHeaders });
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
        "data: " + JSON.stringify({ error: "⚠️ 边缘函数未配置 COZE_TOKEN / COZE_ENDPOINT / PROJECT_ID 环境变量" }) + "\n\n",
        { status: 500, headers: { ...corsHeaders, "Content-Type": "text/event-stream" } }
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
              { type: "text", content: { text: userMessage } },
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
        "data: " + JSON.stringify({ error: `扣子 API 错误 (${cozeResponse.status}): ${errText}` }) + "\n\n",
        { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } }
      );
    }

    // 用 TransformStream 边读边转发：把扣子的 SSE 流实时转成给前端的 delta 流
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    // 异步处理：读扣子的流 -> 解析 -> 写给前端（不 await，让响应先返回，避免函数等待整体完成）
    (async () => {
      const reader = cozeResponse.body.getReader();
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const chunks = buffer.split(/\r?\n\r?\n/);
          buffer = chunks.pop() || "";

          for (const chunk of chunks) {
            let dataStr = "";
            for (const line of chunk.split(/\r?\n/)) {
              if (line.startsWith("data:")) { dataStr = line.slice(5).trim(); break; }
            }
            if (!dataStr || dataStr === "[DONE]") continue;

            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.type === "answer") {
                const piece = parsed.content?.answer;
                if (typeof piece === "string" && piece.length > 0) {
                  await writer.write(encoder.encode("data: " + JSON.stringify({ delta: piece }) + "\n\n"));
                }
              } else if (parsed.type === "error" || parsed.content?.error) {
                const em = parsed.content?.error?.message || parsed.content?.error || "未知错误";
                await writer.write(encoder.encode("data: " + JSON.stringify({ error: String(em) }) + "\n\n"));
              }
            } catch (e) { /* 跳过解析失败的块 */ }
          }
        }
        await writer.write(encoder.encode("data: " + JSON.stringify({ done: true }) + "\n\n"));
      } catch (err) {
        try {
          await writer.write(encoder.encode("data: " + JSON.stringify({ error: "读取流出错：" + err.message }) + "\n\n"));
        } catch (e) {}
      } finally {
        try { await writer.close(); } catch (e) {}
      }
    })();

    // 注意：只设必要的头，不要手动设 Connection / Keep-Alive / Transfer-Encoding
    return new Response(readable, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });

  } catch (err) {
    return new Response(
      "data: " + JSON.stringify({ error: "出错了：" + err.message }) + "\n\n",
      { status: 500, headers: { ...corsHeaders, "Content-Type": "text/event-stream" } }
    );
  }
}
