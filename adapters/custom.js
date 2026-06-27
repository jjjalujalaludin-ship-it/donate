module.exports = function customAdapter(body) {

    const now = new Date();

    return {

        id:
            body.trx ||
            Date.now(),

        source:
            body.source || "custom",

        platform:
            body.platform || "custom",
			
	    title:
			body.title || "Donasi Masuk",

        name:
            body.user ||
            "Anonymous",

        message:
            body.pesan ||
            "",

        media_url:
            body.media_url ||
            "",

        amount_original:
            Number(body.amount || 0),

        amount_unique:
            Number(body.amount || 0),

        video_duration:
            Math.floor(
                Number(body.amount || 0) / 200
            ),

        tanggal:
            now.toLocaleDateString("id-ID"),

        jam:
            now.toLocaleTimeString("id-ID",{
                hour:"2-digit",
                minute:"2-digit"
            }),

        created_at:
            now.getTime()

    };

}