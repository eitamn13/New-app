// Supabase Edge Function: identify-product
// מקבל תמונת מוצר (data URL / base64) ומחזיר שם + מותג באמצעות Claude Vision.
// המפתח ANTHROPIC_API_KEY נשמר כסוד בצד-השרת (לא נחשף ללקוח).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODEL = "claude-opus-4-8"; // דגם ראייה חזק; ניתן להחליף ל-claude-haiku-4-5-20251001 לחיסכון

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ error: "missing_api_key" }, 200);

    const { image, barcode } = await req.json();
    if (!image) return json({ error: "no_image" }, 400);

    // פירוק data URL -> media_type + base64
    let mediaType = "image/jpeg", b64 = image;
    const m = /^data:(.*?);base64,(.*)$/s.exec(image);
    if (m) { mediaType = m[1]; b64 = m[2]; }

    const prompt =
      "זהה את מוצר הצריכה בתמונה (מוצר מדף בסופר/חנות). " +
      (barcode ? `ברקוד: ${barcode}. ` : "") +
      "החזר JSON בלבד בפורמט {\"name\":\"שם המוצר בעברית כולל גודל/משקל אם נראה\",\"brand\":\"מותג או null\"}. " +
      "אם לא ניתן לזהות, החזר {\"name\":null,\"brand\":null}. ללא טקסט נוסף.";

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 200,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } },
            { type: "text", text: prompt },
          ],
        }],
      }),
    });

    if (!resp.ok) return json({ error: "anthropic_error", detail: await resp.text() }, 200);
    const data = await resp.json();
    const text = (data?.content?.[0]?.text || "").trim();
    let parsed = { name: null, brand: null };
    try { parsed = JSON.parse(text.replace(/```json|```/g, "").trim()); } catch { parsed.name = text || null; }
    return json({ name: parsed.name || null, brand: parsed.brand || null }, 200);
  } catch (e) {
    return json({ error: String(e) }, 200);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });
}
