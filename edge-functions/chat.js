// EdgeOne Pages 边缘函数 - 扣子 API 中转
// 部署后访问路径为 /chat
// 
// ⚠️ 使用前必须先在 EdgeOne 项目的"环境变量"里配置两个变量：
//    - COZE_TOKEN  : 你的扣子访问令牌（以 pat_ 开头）
//    - BOT_ID      : 你的智能体 ID（7641240317169205263）

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
    const userMessage = body.message;
    const userId = body.user_id || "user_" + Date.now();

    const COZE_TOKEN = env.COZE_TOKEN;
    const BOT_ID = env.BOT_ID;

    if (!COZE_TOKEN || !BOT_ID) {
      return new Response(
        JSON.stringify({ reply: "⚠️ 边缘函数未配置 COZE_TOKEN 或 BOT_ID 环境变量" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1. 发起对话
    const cozeResponse = await fetch("https://api.coze.cn/v3/chat", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + COZE_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        bot_id: BOT_ID,
        user_id: userId,
        stream: false,
        auto_save_history: true,
        additional_messages: [
          { role: "user", content: userMessage, content_type: "text" },
        ],
      }),
    });

    const initData = await cozeResponse.json();
    if (!initData.data) {
      return new Response(
        JSON.stringify({ reply: "扣子 API 返回异常：" + JSON.stringify(initData) }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const chatId = initData.data.id;
    const conversationId = initData.data.conversation_id;

    // 2. 轮询等待回复完成
    let status = "in_progress";
    let attempts = 0;
    while (status === "in_progress" && attempts < 60) {
      await new Promise(r => setTimeout(r, 1000));
      const statusRes = await fetch(
        `https://api.coze.cn/v3/chat/retrieve?chat_id=${chatId}&conversation_id=${conversationId}`,
        { headers: { "Authorization": "Bearer " + COZE_TOKEN } }
      );
      const statusData = await statusRes.json();
      status = statusData.data.status;
      attempts++;
    }

    // 3. 取最终回复
    const msgRes = await fetch(
      `https://api.coze.cn/v3/chat/message/list?chat_id=${chatId}&conversation_id=${conversationId}`,
      { headers: { "Authorization": "Bearer " + COZE_TOKEN } }
    );
    const msgData = await msgRes.json();
    const answer = msgData.data.find(m => m.type === "answer");

    return new Response(
      JSON.stringify({ reply: answer ? answer.content : "（无回复）" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ reply: "出错了：" + err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}
