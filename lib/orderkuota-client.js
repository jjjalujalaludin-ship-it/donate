const fetch = global.fetch;
const { URLSearchParams } = require("url");
const crypto = require("crypto");
const QRCode = require("qrcode");
const { ImageUploadService } = require("node-upload-images");

class OrderKuota {

  static API_URL = "https://app.orderkuota.com:443/api/v2";

  static HOST = "app.orderkuota.com";

  static USER_AGENT = "okhttp/4.12.0";

  static APP_VERSION_NAME = "25.08.11";
  static APP_VERSION_CODE = "250811";

  static APP_REG_ID =
    "di309HvATsaiCppl5eDpoc:APA91bFUcTOH8h2XHdPRz2qQ5Bezn-3_TaycFcJ5pNLGWpmaxheQP9Ri0E56wLHz0_b1vcss55jbRQXZgc9loSfBdNa5nZJZVMlk7GS1JDMGyFUVvpcwXbMDg8tjKGZAurCGR4kDMDRJ";

  static PHONE_MODEL = "SM-G960N";
  static PHONE_UUID = "di309HvATsaiCppl5eDpoc";

  static PHONE_ANDROID_VERSION = "15";

  constructor(username, authToken) {
    this.username = username;
    this.authToken = authToken;
  }

  buildHeaders() {
    return {
      Host: OrderKuota.HOST,
      "User-Agent": OrderKuota.USER_AGENT,
      "Content-Type": "application/x-www-form-urlencoded",
      "accept-encoding": "gzip"
    };
  }

  async request(method, url, body = null) {
    const res = await fetch(url, {
      method,
      headers: this.buildHeaders(),
      body: body ? body.toString() : null
    });

    return await res.json();
  }

  // =====================
  // GET OTP
  // =====================

  async loginRequest(username, password) {

    const payload = new URLSearchParams({
      username,
      password,
      request_time: Date.now(),
      app_reg_id: OrderKuota.APP_REG_ID,
      phone_android_version: OrderKuota.PHONE_ANDROID_VERSION,
      app_version_code: OrderKuota.APP_VERSION_CODE,
      phone_uuid: OrderKuota.PHONE_UUID
    });

    return await this.request(
      "POST",
      `${OrderKuota.API_URL}/login`,
      payload
    );
  }

  // =====================
  // GET TOKEN
  // =====================

  async getAuthToken(username, otp) {

    const payload = new URLSearchParams({
      username,
      password: otp,
      request_time: Date.now(),
      app_reg_id: OrderKuota.APP_REG_ID,
      phone_android_version: OrderKuota.PHONE_ANDROID_VERSION,
      app_version_code: OrderKuota.APP_VERSION_CODE,
      phone_uuid: OrderKuota.PHONE_UUID
    });

    return await this.request(
      "POST",
      `${OrderKuota.API_URL}/login`,
      payload
    );
  }

  // =====================
  // MUTASI
  // =====================

  async getTransactionQris(type = "") {

    const userId =
      this.authToken.split(":")[0];

    const payload = new URLSearchParams({
      request_time: Date.now(),
      app_reg_id: OrderKuota.APP_REG_ID,
      phone_android_version:
        OrderKuota.PHONE_ANDROID_VERSION,
      app_version_code:
        OrderKuota.APP_VERSION_CODE,
      phone_uuid:
        OrderKuota.PHONE_UUID,
      auth_username:
        this.username,
      auth_token:
        this.authToken,

      "requests[qris_history][jumlah]": "",
      "requests[qris_history][jenis]": type,
      "requests[qris_history][page]": "1",

      "requests[0]": "account",

      app_version_name:
        OrderKuota.APP_VERSION_NAME,

      ui_mode: "light",
      phone_model:
        OrderKuota.PHONE_MODEL
    });

    return this.request(
      "POST",
      `${OrderKuota.API_URL}/qris/mutasi/${userId}`,
      payload
    );
  }

  // =====================
  // GENERATE QRIS
  // =====================

  async generateQr(amount) {

    const payload =
      new URLSearchParams({

        request_time: Date.now(),

        app_reg_id:
          OrderKuota.APP_REG_ID,

        phone_android_version:
          OrderKuota.PHONE_ANDROID_VERSION,

        app_version_code:
          OrderKuota.APP_VERSION_CODE,

        phone_uuid:
          OrderKuota.PHONE_UUID,

        auth_username:
          this.username,

        auth_token:
          this.authToken,

        "requests[qris_merchant_terms][jumlah]":
          amount,

        "requests[0]":
          "qris_merchant_terms",

        app_version_name:
          OrderKuota.APP_VERSION_NAME,

        phone_model:
          OrderKuota.PHONE_MODEL
      });

    const response =
      await this.request(
        "POST",
        `${OrderKuota.API_URL}/get`,
        payload
      );

    return response.qris_merchant_terms.results;
  }
}

function convertCRC16(str) {
  let crc = 0xFFFF;
  for (let c = 0; c < str.length; c++) {
    crc ^= str.charCodeAt(c) << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
    }
  }
  return ("000" + (crc & 0xFFFF).toString(16).toUpperCase()).slice(-4);
}

function generateTransactionId() {
  return `SKYZOPEDIA-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

function generateExpirationTime() {
  const expirationTime = new Date();
  expirationTime.setMinutes(expirationTime.getMinutes() + 30);
  return expirationTime;
}

async function elxyzFile(buffer) {
  const service = new ImageUploadService('pixhost.to');
  const { directLink } = await service.uploadFromBinary(buffer, 'skyzo.png');
  return directLink;
}

async function createQRIS(amount, codeqr) {
  let qrisData = codeqr;
  qrisData = qrisData.slice(0, -4);
  const step1 = qrisData.replace("010211", "010212");
  const step2 = step1.split("5802ID");
  amount = amount.toString();
  let uang = "54" + ("0" + amount.length).slice(-2) + amount;
  uang += "5802ID";
  const final = step2[0] + uang + step2[1];
  const result = final + convertCRC16(final);
  const buffer = await QRCode.toBuffer(result);
  const uploadedFile = await elxyzFile(buffer);
  return {
    idtransaksi: generateTransactionId(),
    jumlah: amount,
    expired: generateExpirationTime(),
    imageqris: { url: uploadedFile }
  };
}

module.exports = {
  OrderKuota,
  createQRIS
};