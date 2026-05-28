// EdgeOne Pages 边缘函数 - 扣子编程项目 API 中转（流式版，解决长内容超时）
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

    // 调扣子编程的 stream_run API（流式）
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

    // 关键改动：一边读扣子的流，一边把提取出的文本片段实时转发给前端
    // 这样函数不需要"挂着等全部生成完"，从根本上避免超时
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    const reader = cozeResponse.body.getReader();

    const stream = new ReadableStream({
      async start(controller) {
        let buffer = "";
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            // 扣子的 SSE 用 \n\n 分块
            const chunks = buffer.split(/\r?\n\r?\n/);
            buffer = chunks.pop() || "";

            for (const chunk of chunks) {
              // 取 data: 后面的 JSON
              let dataStr = "";
              for (const line of chunk.split(/\r?\n/)) {
                if (line.startsWith("data:")) { dataStr = line.slice(5).trim(); break; }
              }
              if (!dataStr || dataStr === "[DONE]") continue;

              try {
                const parsed = JSON.parse(dataStr);
                // answer 类型：把文本片段实时发给前端
                if (parsed.type === "answer") {
                  const piece = parsed.content?.answer;
                  if (typeof piece === "string" && piece.length > 0) {
                    controller.enqueue(encoder.encode(
                      "data: " + JSON.stringify({ delta: piece }) + "\n\n"
                    ));
                  }
                } else if (parsed.type === "error" || parsed.content?.error) {
                  const em = parsed.content?.error?.message || parsed.content?.error || "未知错误";
                  controller.enqueue(encoder.encode(
                    "data: " + JSON.stringify({ error: String(em) }) + "\n\n"
                  ));
                }
              } catch (e) { /* 跳过解析失败的块 */ }
            }
          }
          // 通知前端结束
          controller.enqueue(encoder.encode("data: " + JSON.stringify({ done: true }) + "\n\n"));
          controller.close();
        } catch (err) {
          controller.enqueue(encoder.encode(
            "data: " + JSON.stringify({ error: "读取流出错：" + err.message }) + "\n\n"
          ));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });

  } catch (err) {
    return new Response(
      "data: " + JSON.stringify({ error: "出错了：" + err.message }) + "\n\n",
      { status: 500, headers: { ...corsHeaders, "Content-Type": "text/event-stream" } }
    );
  }
}
