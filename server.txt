const express = require("express");
const axios = require("axios");

const app = express();

const PORT = process.env.PORT || 3000;

const API =
  "https://wtxmd52.tele68.com/v1/txmd5/lite-sessions?cp=R&cl=R&pf=web&at=62385f65eb49fcb34c72a7d6489ad91d";

let DATA = {
  phien: 0,
  ket_qua: "",
  xuc_xac: "",
  du_doan: "",
  do_tin_cay: "",
  cau_dang_chay: ""
};

// ======================
// TÀI / XỈU
// ======================
function taiXiu(total) {
  return total >= 11 ? "tài" : "xỉu";
}

// ======================
// CẦU ĐANG CHẠY
// ======================
function getCau(history, limit = 12) {

  return history
    .slice(0, limit)
    .map((i) => (i === "tài" ? "t" : "x"))
    .join("");
}

// ======================
// ĐẾM BỆT
// ======================
function streak(history) {

  if (!history.length) return 0;

  let count = 1;

  const first = history[0];

  for (let i = 1; i < history.length; i++) {

    if (history[i] === first) {
      count++;
    } else {
      break;
    }
  }

  return count;
}

// ======================
// CẦU 1-1
// txtxtxtx
// ======================
function isAlternating(history, len = 6) {

  const arr = history.slice(0, len);

  for (let i = 1; i < arr.length; i++) {

    if (arr[i] === arr[i - 1]) {
      return false;
    }
  }

  return true;
}

// ======================
// CẦU 2-2
// ttxxttxx
// ======================
function is22(history) {

  const s = history
    .slice(0, 8)
    .map((i) => (i === "tài" ? "t" : "x"))
    .join("");

  return (
    s.startsWith("ttxx") ||
    s.startsWith("xxtt")
  );
}

// ======================
// THUẬT TOÁN AI
// ======================
function predict(history) {

  const recent = history.slice(0, 30);

  let tai = 0;
  let xiu = 0;

  recent.forEach((i) => {

    if (i === "tài") tai++;
    else xiu++;

  });

  const current = history[0];

  const chain = streak(history);

  // ======================
  // CẦU BỆT MẠNH
  // ======================
  if (chain >= 5) {

    // bệt quá dài -> bẻ mạnh
    if (chain >= 8) {

      return {
        du_doan:
          current === "tài"
            ? "xỉu"
            : "tài",

        do_tin_cay: "90%"
      };
    }

    // theo bệt
    return {

      du_doan: current,

      do_tin_cay: `${78 + chain}%`
    };
  }

  // ======================
  // CẦU 1-1
  // ======================
  if (isAlternating(history)) {

    return {

      du_doan:
        current === "tài"
          ? "xỉu"
          : "tài",

      do_tin_cay: "84%"
    };
  }

  // ======================
  // CẦU 2-2
  // ======================
  if (is22(history)) {

    const s = getCau(history, 4);

    if (s === "ttxx") {

      return {
        du_doan: "tài",
        do_tin_cay: "82%"
      };
    }

    if (s === "xxtt") {

      return {
        du_doan: "xỉu",
        do_tin_cay: "82%"
      };
    }
  }

  // ======================
  // XU HƯỚNG
  // ======================
  const diff = Math.abs(tai - xiu);

  if (tai > xiu) {

    return {

      du_doan: "tài",

      do_tin_cay: `${65 + diff}%`
    };
  }

  return {

    du_doan: "xỉu",

    do_tin_cay: `${65 + diff}%`
  };
}

// ======================
// UPDATE
// ======================
async function update() {
  try {

    const res = await axios.get(API, {
      timeout: 10000
    });

    let sessions = [];

    if (Array.isArray(res.data)) {
      sessions = res.data;
    } else if (Array.isArray(res.data.data)) {
      sessions = res.data.data;
    } else if (Array.isArray(res.data.sessions)) {
      sessions = res.data.sessions;
    } else if (Array.isArray(res.data.items)) {
      sessions = res.data.items;
    } else if (Array.isArray(res.data.list)) {
      sessions = res.data.list;
    }

    if (!sessions.length) {
      console.log("KHÔNG CÓ SESSION");
      return;
    }

    // phiên mới nhất
    const current = sessions[0];

    // lịch sử
    const history = [];

    for (const s of sessions) {

      let dice =
        s.dices ||
        s.dice ||
        s.result ||
        [];

      if (!Array.isArray(dice)) continue;

      const d1 = Number(dice[0] || 0);
      const d2 = Number(dice[1] || 0);
      const d3 = Number(dice[2] || 0);

      const total = d1 + d2 + d3;

      history.push(taiXiu(total));
    }

    // xúc xắc hiện tại
    let dice =
      current.dices ||
      current.dice ||
      current.result ||
      [1, 1, 1];

    const d1 = Number(dice[0] || 1);
    const d2 = Number(dice[1] || 1);
    const d3 = Number(dice[2] || 1);

    const ket_qua = taiXiu(d1 + d2 + d3);

    const p = predict(history);

    DATA = {

      phien:
        current.session ||
        current.issue ||
        current.id ||
        Date.now(),

      ket_qua,

      xuc_xac: `${d1}-${d2}-${d3}`,

      du_doan: p.du_doan,

      do_tin_cay: p.do_tin_cay,

      cau_dang_chay: getCau(history)
    };

    console.log("UPDATED:", DATA);

  } catch (e) {

    console.log("ERROR:", e.message);
  }
}

// chạy ngay
update();

// cập nhật nhanh
setInterval(update, 1500);

// ======================
// API
// ======================
app.get("/", (req, res) => {
  res.json(DATA);
});

app.get("/sessions", (req, res) => {
  res.json(DATA);
});

app.listen(PORT, () => {
  console.log("SERVER RUNNING PORT", PORT);
});