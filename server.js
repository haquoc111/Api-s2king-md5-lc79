const express = require("express");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

const API_URL =
  "https://wtxmd52.tele68.com/v1/txmd5/lite-sessions?cp=R&cl=R&pf=web&at=4d3971b6956a5309f02b8bf55c093399";

// ─────────────────────────────────────────────
//  FETCH DATA
// ─────────────────────────────────────────────
async function fetchSessions() {
  const res = await axios.get(API_URL, { timeout: 8000 });
  // API trả list mới nhất ở đầu → đảo lại để oldest-first
  return res.data.list.slice().reverse();
}

// ─────────────────────────────────────────────
//  UTILITIES
// ─────────────────────────────────────────────
const toLabel = (r) => (r === "TAI" ? "tài" : "xỉu");
const toResult = (r) => r; // "TAI" | "XIU"

// ─────────────────────────────────────────────
//  THUẬT TOÁN 1 – PHÂN TÍCH CẦU (streak / pattern)
// ─────────────────────────────────────────────
function analyzeCau(list) {
  const results = list.map((s) => s.resultTruyenThong); // ["XIU","TAI",...]

  // --- Cầu hiện tại ---
  let streakLen = 1;
  let streakVal = results[results.length - 1];
  for (let i = results.length - 2; i >= 0; i--) {
    if (results[i] === streakVal) streakLen++;
    else break;
  }

  // --- Phát hiện cầu 1-1 (bệt xen kẽ) ---
  let altCount = 0;
  for (let i = results.length - 1; i >= 1; i--) {
    if (results[i] !== results[i - 1]) altCount++;
    else break;
  }

  // --- Xác suất điểm (dựa trên phân phối xúc xắc) ---
  const points = list.map((s) => s.point);
  const avgPoint =
    points.reduce((a, b) => a + b, 0) / points.length;

  // --- Thống kê 15 phiên gần nhất ---
  const recent = results.slice(-15);
  const taiCount = recent.filter((r) => r === "TAI").length;
  const xiuCount = recent.length - taiCount;

  return { streakLen, streakVal, altCount, avgPoint, taiCount, xiuCount, results };
}

// ─────────────────────────────────────────────
//  THUẬT TOÁN 2 – SIÊU BÁM CẦU / BẺ CẦU
// ─────────────────────────────────────────────
function superCauStrategy(analysis) {
  const { streakLen, streakVal, altCount, taiCount, xiuCount, results } = analysis;
  const total = taiCount + xiuCount;

  let action = "BAM"; // "BAM" | "BE"
  let predict = streakVal; // mặc định bám theo cầu hiện tại
  let reason = "";
  let confidence = 70;

  // ── DẤU HIỆU BẺ CẦU ──────────────────────────────
  // 1. Cầu dài ≥ 5: xác suất đứt cao
  if (streakLen >= 5) {
    action = "BE";
    predict = streakVal === "TAI" ? "XIU" : "TAI";
    reason = `Cầu ${toLabel(streakVal)} dài ${streakLen} phiên → Bẻ cầu`;
    confidence = 65 + Math.min(streakLen * 3, 20);
  }
  // 2. Cầu 1-1 xen kẽ dài ≥ 4: khả năng tiếp tục xen kẽ
  else if (altCount >= 4) {
    action = "BAM";
    predict = streakVal === "TAI" ? "XIU" : "TAI"; // tiếp tục xen kẽ
    reason = `Cầu 1-1 xen kẽ ${altCount} lần → Tiếp tục xen kẽ`;
    confidence = 72 + Math.min(altCount * 2, 15);
  }
  // 3. Mất cân bằng nặng (>70%) trong 15 phiên → chờ hồi
  else if (taiCount / total > 0.73) {
    action = "BE";
    predict = "XIU";
    reason = `Tài áp đảo ${taiCount}/${total} phiên → Hồi về xỉu`;
    confidence = 68;
  } else if (xiuCount / total > 0.73) {
    action = "BE";
    predict = "TAI";
    reason = `Xỉu áp đảo ${xiuCount}/${total} phiên → Hồi về tài`;
    confidence = 68;
  }
  // 4. Cầu 2-2 (đôi xen kẽ): nhận diện pattern
  else if (
    results.length >= 4 &&
    results[results.length - 1] === results[results.length - 2] &&
    results[results.length - 3] === results[results.length - 4] &&
    results[results.length - 1] !== results[results.length - 3]
  ) {
    const opp = streakVal === "TAI" ? "XIU" : "TAI";
    action = "BAM";
    predict = opp; // bắt đầu cặp mới
    reason = `Cầu 2-2 đang hình thành → Theo cặp tiếp theo`;
    confidence = 74;
  }
  // 5. Cầu ngắn (1-2): bám theo
  else {
    action = "BAM";
    predict = streakVal;
    reason = `Cầu ${toLabel(streakVal)} ${streakLen} phiên → Bám theo`;
    confidence = 62 + streakLen * 3;
  }

  return { action, predict, reason, confidence: Math.min(confidence, 97) };
}

// ─────────────────────────────────────────────
//  THUẬT TOÁN 3 – ĐIỂM XÚC XẮC (xác suất toán học)
// ─────────────────────────────────────────────
function dicePointPredict(list) {
  // Tính điểm trung bình động 5 phiên
  const recent5 = list.slice(-5).map((s) => s.point);
  const avg5 = recent5.reduce((a, b) => a + b, 0) / recent5.length;
  // Điểm 3-10 = xỉu, 11-18 = tài (theo quy tắc chuẩn)
  // avg > 10.5 → xu hướng tài, < 10.5 → xu hướng xỉu
  const trendByPoint = avg5 > 10.5 ? "TAI" : "XIU";
  return { avg5: avg5.toFixed(2), trendByPoint };
}

// ─────────────────────────────────────────────
//  TỔNG HỢP DỰ ĐOÁN CUỐI
// ─────────────────────────────────────────────
function finalPredict(list) {
  const analysis = analyzeCau(list);
  const cau = superCauStrategy(analysis);
  const dice = dicePointPredict(list);

  const latest = list[list.length - 1];
  const nextId = latest.id + 1;

  // Bỏ phiếu: cầu + điểm
  let votes = { TAI: 0, XIU: 0 };
  votes[cau.predict] += 2; // cầu trọng số cao hơn
  votes[dice.trendByPoint] += 1;

  const finalResult = votes.TAI >= votes.XIU ? "TAI" : "XIU";
  const finalLabel = toLabel(finalResult);

  // Điều chỉnh độ tin cậy
  let conf = cau.confidence;
  if (dice.trendByPoint === cau.predict) conf = Math.min(conf + 8, 97);
  else conf = Math.max(conf - 5, 55);

  const dicesStr = latest.dices.join("-");

  return {
    id: "s2king",
    Phien: latest.id,
    Ket_qua: toLabel(latest.resultTruyenThong),
    Xuc_xac: dicesStr,
    Phien_hien_tai: nextId,
    Du_doan: finalLabel,
    Do_tin_cay: `${conf}%`,
    // Chi tiết phân tích
    Phan_tich: {
      Hanh_dong: cau.action === "BAM" ? "🔥 BÁM CẦU" : "⚡ BẺ CẦU",
      Ly_do: cau.reason,
      Cau_hien_tai: `${toLabel(analysis.streakVal).toUpperCase()} x${analysis.streakLen}`,
      Diem_TB_5_phien: dice.avg5,
      Thong_ke_15_phien: `Tài: ${analysis.taiCount} | Xỉu: ${analysis.xiuCount}`,
    },
  };
}

// ─────────────────────────────────────────────
//  ROUTES
// ─────────────────────────────────────────────

// GET /predict – dự đoán ngay
app.get("/predict", async (req, res) => {
  try {
    const list = await fetchSessions();
    const result = finalPredict(list);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /history – lịch sử 15 phiên
app.get("/history", async (req, res) => {
  try {
    const list = await fetchSessions();
    const formatted = list.map((s) => ({
      Phien: s.id,
      Ket_qua: toLabel(s.resultTruyenThong),
      Xuc_xac: s.dices.join("-"),
      Diem: s.point,
    }));
    res.json({ id: "s2king", Lich_su: formatted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET / – health check + dự đoán nhanh
app.get("/", async (req, res) => {
  try {
    const list = await fetchSessions();
    const result = finalPredict(list);
    res.json({
      status: "✅ Server đang chạy",
      ...result,
    });
  } catch (err) {
    res.status(500).json({ status: "❌ Lỗi", error: err.message });
  }
});

// ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🎲 Server tài xỉu s2king đang chạy tại cổng ${PORT}`);
});