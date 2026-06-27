module.exports = function sociabuzzAdapter(body) {

    const created =
        body.created_at
            ? new Date(body.created_at)
            : new Date();

    return {

        // ===============================
        // IDENTITAS
        // ===============================

        id:
            body.unique_trx_id ||
            body.id,

        source:
            "sociabuzz",

        platform:
            "sociabuzz",

        title:
            "Sociabuzz Donation",

        // ===============================
        // DONATUR
        // ===============================

        name:
            body.supporter ||
            "Anonymous",

        email:
            body.email_supporter || "",

        message:
            body.message || "",

        // ===============================
        // MEDIA
        // ===============================

        media_type:
            body.media_type || "",

        media_url:
            body.media_url || "",

        // ===============================
        // NOMINAL
        // ===============================

        amount_original:
            Number(body.amount || 0),

        amount_unique:
            Number(body.amount || 0),

        amount_settled:
            Number(body.amount_settled || body.amount || 0),

        currency:
            body.currency || "IDR",

        currency_settled:
            body.currency_settled || "IDR",

        // ===============================
        // OVERLAY
        // ===============================

        video_duration:
            Math.floor(
                Number(body.amount || 0) / 200
            ),

        tanggal:
            created.toLocaleDateString("id-ID"),

        jam:
            created.toLocaleTimeString("id-ID", {
                hour: "2-digit",
                minute: "2-digit"
            }),

        created_at:
            created.getTime(),

        // ===============================
        // DATA SOCIABUZZ
        // ===============================

        item:
            body.item || null,

        level:
            body.level || null,

        vote:
            body.vote || null,

        content:
            body.content || null,

        // Payload asli
        raw:
            body

    };

};