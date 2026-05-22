// EdgeOne Pages 边缘函数 - 扣子编程项目 API 中转（最终版）
// 部署后访问路径为 /chat
//
// ⚠️ 必须在 EdgeOne 项目"环境变量"里配置三个变量：
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

    // 解析 SSE 流
    // 数据结构：每行 "event: message" + "data: {JSON}"
    // 关键字段：data.type === "answer" 时，data.content.answer 是文本片段
    // 按 sequence_id 顺序拼接所有 answer 片段，得到完整回复
    const rawText = await cozeResponse.text();
    const answerMap = new Map();  // sequence_id -> text，去重 + 排序
    let errorMsg = "";

    // 按 SSE 规范：事件之间用空行（\n\n）分隔
    const events = rawText.split(/\r?\n\r?\n/);

    for (const eventBlock of events) {
      if (!eventBlock.trim()) continue;

      // 取 data: 后面的 JSON 部分
      const lines = eventBlock.split(/\r?\n/);
      let dataStr = "";
      for (const line of lines) {
        if (line.startsWith("data:")) {
          dataStr = line.slice(5).trim();
          break;
        }
      }
      if (!dataStr || dataStr === "[DONE]") continue;

      try {
        const parsed = JSON.parse(dataStr);

        if (parsed.type === "answer") {
          const piece = parsed.content?.answer;
          if (typeof piece === "string" && piece.length > 0) {
            // 用 sequence_id 做 key 去重（流式传输有时会重复推送）
            answerMap.set(parsed.sequence_id, piece);
          }
        } else if (parsed.type === "error" || parsed.content?.error) {
          errorMsg = parsed.content?.error?.message
                  || parsed.content?.error
                  || JSON.stringify(parsed);
        }
      } catch (e) {
        // 跳过解析失败的块
      }
    }

    if (errorMsg) {
      return new Response(
        JSON.stringify({ reply: "扣子返回错误：" + errorMsg }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 按 sequence_id 升序拼接
    const sortedKeys = Array.from(answerMap.keys()).sort((a, b) => a - b);
    const fullAnswer = sortedKeys.map(k => answerMap.get(k)).join("");

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
