const express = require("express");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

const API_URL =
  "https://wtxmd52.tele68.com/v1/txmd5/lite-sessions?cp=R&cl=R&pf=web&at=4d3971b6956a5309f02b8bf55c093399";

// ═══════════════════════════════════════════════════
//  FETCH
// ═══════════════════════════════════════════════════
async function fetchSessions() {
  const res = await axios.get(API_URL, { timeout: 8000 });
  return res.data.list.slice().reverse(); // oldest → newest
}

const lb = (r) => (r === "TAI" ? "tài" : "xỉu");
const opp = (r) => (r === "TAI" ? "XIU" : "TAI");

// ═══════════════════════════════════════════════════
//  MODULE 1 – PHÂN TÍCH CẦU
// ═══════════════════════════════════════════════════
function parseCau(results) {
  const n = results.length;

  // Streak hiện tại
  let streakVal = results[n - 1];
  let streakLen = 0;
  for (let i = n - 1; i >= 0 && results[i] === streakVal; i--) streakLen++;

  // Toàn bộ lịch sử streak
  const streakHistory = [];
  let cv = results[0], cl = 1;
  for (let i = 1; i < n; i++) {
    if (results[i] === cv) cl++;
    else { streakHistory.push({ val: cv, len: cl }); cv = results[i]; cl = 1; }
  }
  streakHistory.push({ val: cv, len: cl });

  // Streak đã hoàn thành (không tính streak cuối đang chạy)
  const done = streakHistory.slice(0, -1);
  const avgLen = done.length
    ? done.reduce((a, b) => a + b.len, 0) / done.length
    : 2.5;

  // Phát hiện cầu xen kẽ 1-1
  let altLen = 1;
  for (let i = n - 1; i >= 1 && results[i] !== results[i - 1]; i--) altLen++;

  // Phát hiện cầu đôi 2-2
  let pairChain = 0;
  let pi = n - 1;
  let lastPairVal = null;
  while (pi >= 1 && results[pi] === results[pi - 1]) {
    const pv = results[pi];
    if (pv !== lastPairVal) { pairChain++; lastPairVal = pv; pi -= 2; }
    else break;
  }

  // Thống kê 15 phiên
  const taiCount = results.filter((r) => r === "TAI").length;
  const xiuCount = n - taiCount;

  // Phân tích điểm số
  return { n, streakVal, streakLen, streakHistory, done, avgLen, altLen, pairChain, taiCount, xiuCount };
}

// ═══════════════════════════════════════════════════
//  MODULE 2 – HỆ THỐNG TÍN HIỆU (có trọng số)
// ═══════════════════════════════════════════════════
/**
 * weight > 0  → nghiêng về BẺ CẦU
 * weight < 0  → nghiêng về BÁM CẦU
 */
function calcSignals(cau, list) {
  const signals = [];
  const { streakVal, streakLen, avgLen, altLen, pairChain, taiCount, xiuCount, n, done } = cau;

  // ───── TÍN HIỆU BẺ CẦU ─────

  // [A] Streak vượt ngưỡng tự nhiên theo lịch sử
  // Ngưỡng bẻ động = avgLen * 1.4 (ít nhất là 3)
  const breakThreshold = Math.max(Math.ceil(avgLen * 1.4), 3);
  if (streakLen >= breakThreshold) {
    const excess = streakLen - breakThreshold;
    signals.push({
      side: "BE",
      weight: 30 + excess * 12,
      desc: `Cầu ${lb(streakVal)} ${streakLen} phiên ≥ ngưỡng bẻ ${breakThreshold} (TB lịch sử ${avgLen.toFixed(1)})`,
    });
  }

  // [B] Streak cực dài tuyệt đối ≥ 5 (dù lịch sử dài cỡ nào)
  if (streakLen >= 5) {
    signals.push({
      side: "BE",
      weight: 25 + (streakLen - 5) * 10,
      desc: `Cầu ${lb(streakVal)} tuyệt đối ${streakLen} phiên → Bẻ bắt buộc`,
    });
  }

  // [C] Mất cân bằng nặng (>70% trong 15 phiên)
  const taiRatio = taiCount / n;
  if (taiRatio > 0.70 && streakVal === "TAI") {
    signals.push({ side: "BE", weight: 22, desc: `Tài chiếm ${Math.round(taiRatio * 100)}%/15 phiên → Hồi xỉu` });
  } else if (taiRatio < 0.30 && streakVal === "XIU") {
    signals.push({ side: "BE", weight: 22, desc: `Xỉu chiếm ${Math.round((1 - taiRatio) * 100)}%/15 phiên → Hồi tài` });
  }

  // [D] Điểm xúc xắc 3 phiên gần nhất tiệm cận ngưỡng đổi chiều
  const pts3 = list.slice(-3).map((s) => s.point);
  const avg3 = pts3.reduce((a, b) => a + b, 0) / 3;
  if (streakVal === "XIU" && avg3 >= 9.0) {
    // Xỉu nhưng điểm đang tăng gần 11
    signals.push({ side: "BE", weight: 14, desc: `Đang cầu xỉu nhưng điểm TB 3 phiên = ${avg3.toFixed(1)} đang leo lên` });
  } else if (streakVal === "TAI" && avg3 <= 12.0) {
    signals.push({ side: "BE", weight: 14, desc: `Đang cầu tài nhưng điểm TB 3 phiên = ${avg3.toFixed(1)} đang rớt xuống` });
  }

  // [E] Pattern streak ngắn liên tiếp (thị trường đảo rất nhanh)
  const last5done = done.slice(-5);
  if (last5done.length >= 4 && last5done.every((s) => s.len <= 2)) {
    // Cầu ngắn liên tiếp → KHÔNG có cầu ổn định → không bám
    signals.push({ side: "BE", weight: 18, desc: `Lịch sử 5 streak gần nhất đều ≤2 phiên → Thị trường flip nhanh` });
  }

  // [F] Streak vừa đổi chiều lần thứ 3 liên tiếp sau streak ngắn
  const last3done = done.slice(-3);
  if (last3done.length === 3 && last3done.every((s) => s.len === 1) && streakLen === 1) {
    signals.push({ side: "BE", weight: 20, desc: `Cầu 1-1-1 đang hình thành → Tiếp tục xen kẽ (bẻ ngay)` });
  }

  // ───── TÍN HIỆU BÁM CẦU ─────

  // [G] Streak còn ngắn so với lịch sử → chưa đến lúc bẻ
  if (streakLen < Math.max(Math.floor(avgLen * 0.8), 2)) {
    signals.push({ side: "BAM", weight: -20, desc: `Cầu mới ${streakLen} phiên, lịch sử TB ${avgLen.toFixed(1)} → Còn room bám` });
  }

  // [H] Cầu đôi 2-2 đang hình thành (pairChain ≥ 2) → tiếp tục cặp
  if (pairChain >= 2 && streakLen === 1) {
    signals.push({ side: "BAM", weight: -18, desc: `Cầu 2-2 đang lặp (${pairChain} cặp) → Chờ thêm 1 phiên nữa` });
  }

  // [I] Điểm xúc xắc 5 phiên xác nhận cùng chiều streak
  const pts5 = list.slice(-5).map((s) => s.point);
  const avg5 = pts5.reduce((a, b) => a + b, 0) / 5;
  if (streakVal === "TAI" && avg5 >= 11.5) {
    signals.push({ side: "BAM", weight: -12, desc: `Điểm TB 5 phiên = ${avg5.toFixed(1)} xác nhận xu hướng tài` });
  } else if (streakVal === "XIU" && avg5 <= 9.5) {
    signals.push({ side: "BAM", weight: -12, desc: `Điểm TB 5 phiên = ${avg5.toFixed(1)} xác nhận xu hướng xỉu` });
  }

  return signals;
}

// ═══════════════════════════════════════════════════
//  MODULE 3 – QUYẾT ĐỊNH CUỐI
// ═══════════════════════════════════════════════════
function makeDecision(cau, signals, list) {
  const { streakVal, altLen, streakLen } = cau;

  const breakScore = signals.filter((s) => s.side === "BE").reduce((a, b) => a + b.weight, 0);
  const bamScore = Math.abs(signals.filter((s) => s.side === "BAM").reduce((a, b) => a + b.weight, 0));
  const netScore = breakScore - bamScore; // > 0 → bẻ, < 0 → bám

  // Ngưỡng bẻ: net ≥ 25 → bẻ
  const BREAK_THRESHOLD = 25;

  let predict, action, mainReason;
  let confidence;

  // Ưu tiên cao: cầu 1-1 xen kẽ rõ ràng
  if (altLen >= 4 && streakLen === 1) {
    predict = opp(streakVal); // tiếp tục xen kẽ
    action = "XEN_KE";
    const sig = signals.find((s) => s.desc.includes("1-1"));
    mainReason = sig ? sig.desc : `Cầu xen kẽ ${altLen} phiên → tiếp tục đảo chiều`;
    confidence = 65 + Math.min(altLen * 4, 22);
  } else if (netScore >= BREAK_THRESHOLD) {
    predict = opp(streakVal);
    action = "BE_CAU";
    // Lý do quan trọng nhất
    const topSig = signals.filter((s) => s.side === "BE").sort((a, b) => b.weight - a.weight)[0];
    mainReason = topSig.desc;
    confidence = 58 + Math.min(netScore / 2.5, 32);
  } else {
    predict = streakVal;
    action = "BAM_CAU";
    const topSig = signals.filter((s) => s.side === "BAM").sort((a, b) => a.weight - b.weight)[0];
    mainReason = topSig
      ? topSig.desc
      : `Không có tín hiệu bẻ (net=${netScore}) → Bám ${lb(streakVal)}`;
    confidence = 58 + Math.min(bamScore / 2, 28);
  }

  // Xác nhận thêm từ điểm xúc xắc
  const avg5 = list.slice(-5).map((s) => s.point).reduce((a, b) => a + b, 0) / 5;
  const dicePredict = avg5 > 10.5 ? "TAI" : "XIU";
  if (dicePredict === predict) confidence = Math.min(confidence + 6, 96);
  else confidence = Math.max(confidence - 4, 50);

  return {
    predict, action, mainReason,
    confidence: Math.round(confidence),
    breakScore, bamScore, netScore,
    avg5: avg5.toFixed(2),
  };
}

// ═══════════════════════════════════════════════════
//  FULL ANALYZE
// ═══════════════════════════════════════════════════
function analyze(list) {
  const results = list.map((s) => s.resultTruyenThong);
  const cau = parseCau(results);
  const signals = calcSignals(cau, list);
  const dec = makeDecision(cau, signals, list);

  const latest = list[list.length - 1];

  const actionLabel = {
    BAM_CAU: "🔥 BÁM CẦU",
    BE_CAU:  "⚡ BẺ CẦU",
    XEN_KE:  "🔄 XEN KẼ",
  }[dec.action];

  return {
    id: "s2king",
    Phien: latest.id,
    Ket_qua: lb(latest.resultTruyenThong),
    Xuc_xac: latest.dices.join("-"),
    Phien_hien_tai: latest.id + 1,
    Du_doan: lb(dec.predict),
    Do_tin_cay: `${dec.confidence}%`,
    Phan_tich: {
      Hanh_dong: actionLabel,
      Ly_do: dec.mainReason,
      Diem_BE: dec.breakScore,
      Diem_BAM: dec.bamScore,
      Chenh_lech: dec.netScore,
      Cau_hien_tai: `${lb(cau.streakVal).toUpperCase()} × ${cau.streakLen} phiên`,
      Streak_TB_ls: `${cau.avgLen.toFixed(1)} phiên`,
      Nguong_be_dong: `${Math.max(Math.ceil(cau.avgLen * 1.4), 3)} phiên`,
      Diem_TB_5p: dec.avg5,
      Thong_ke_15p: `Tài ${cau.taiCount} – Xỉu ${cau.xiuCount}`,
      Tin_hieu: signals.map((s) => `[${s.side} ${s.weight > 0 ? "+" : ""}${s.weight}] ${s.desc}`),
    },
  };
}

// ═══════════════════════════════════════════════════
//  ROUTES
// ═══════════════════════════════════════════════════
app.get("/predict", async (req, res) => {
  try { res.json(analyze(await fetchSessions())); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/history", async (req, res) => {
  try {
    const list = await fetchSessions();
    res.json({
      id: "s2king",
      Lich_su: list.map((s) => ({
        Phien: s.id,
        Ket_qua: lb(s.resultTruyenThong),
        Xuc_xac: s.dices.join("-"),
        Diem: s.point,
      })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/", async (req, res) => {
  try { res.json({ status: "✅ OK", ...analyze(await fetchSessions()) }); }
  catch (e) { res.status(500).json({ status: "❌ Lỗi", error: e.message }); }
});

app.listen(PORT, () => console.log(`🎲 s2king chạy tại cổng ${PORT}`));