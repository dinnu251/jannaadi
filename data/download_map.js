const https = require('https');
const fs = require('fs');

const url = "https://www.gvmc.gov.in/wss/static_content/banner_images/Zonal%20Maps_South%20Zone.jpg";

https.get(url, (res) => {
    console.log("Status Code:", res.statusCode);
    if(res.statusCode === 200) {
        const file = fs.createWriteStream("C:\\Users\\nagen\\JanNaadi\\jannaadi\\frontend\\public\\Zonal_Maps_South_Zone.jpg");
        res.pipe(file);
        file.on('finish', () => {
            file.close();
            console.log("Download Completed!");
        });
    }
}).on('error', (err) => {
    console.log("Error: ", err.message);
});
