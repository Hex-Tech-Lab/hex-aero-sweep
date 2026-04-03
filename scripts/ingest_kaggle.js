import fs from 'fs';
import csv from 'csv-parser';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const inputPath = path.resolve(__dirname, '../data/aegean_historical.csv');
const outputPath = path.resolve(__dirname, '../data/aegean_priors.json');

const results = [];

fs.createReadStream(inputPath)
  .pipe(csv())
  .on('data', (data) => {
    if (data.Cabin && data.FareClass && data.BasePrice) {
      results.push({
        cabin: data.Cabin.trim(),
        brand: data.Brand ? data.Brand.trim() : 'Light',
        class: data.FareClass.trim(),
        historical_price: parseFloat(data.BasePrice),
        volatility_index: parseFloat(data.Volatility || 0.1)
      });
    }
  })
  .on('end', () => {
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(`✅ Ingested ${results.length} historical records into aegean_priors.json`);
  });
