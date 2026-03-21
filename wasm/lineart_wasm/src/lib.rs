use wasm_bindgen::prelude::*;
use serde::Deserialize;

#[derive(Deserialize)]
struct Params {
    mode: String,
    threshold: u8,
    blur: u8,
    edge_str: u16,
    adapt_block: u8,
    adapt_c: i16,
    line_width: u8,
    thin_noise: u8,
    scan_bg: u8,
    scan_contrast: u8,
    scan_thin: u8,
    invert: bool,
    blacks: f32,
    shadows: f32,
    highlights: f32,
}

#[wasm_bindgen]
pub fn process_lineart(rgba: &[u8], w: u32, h: u32, params: JsValue) -> Vec<u8> {
    let p: Params = serde_wasm_bindgen::from_value(params).unwrap();
    let w = w as usize;
    let h = h as usize;
    let n = w * h;

    // LUT
    let mut lut = [0u8; 256];
    let apply_lut = p.blacks != 0.0 || p.shadows != 0.0 || p.highlights != 0.0;
    if apply_lut {
        for v in 0..256 {
            let mut val = v as f32;
            val = val * (255.0 - p.blacks) / 255.0 + p.blacks;
            if p.shadows != 0.0 {
                let t = 1.0 - (val / 128.0).min(1.0);
                val += p.shadows * t;
            }
            if p.highlights != 0.0 {
                let t = ((val - 128.0) / 128.0).max(0.0);
                val += p.highlights * t;
            }
            let v2 = val.round().clamp(0.0, 255.0) as u8;
            lut[v] = v2;
        }
    }

    // grayscale
    let mut gray = vec![0u8; n];
    for i in 0..n {
        let r = rgba[i * 4];
        let g = rgba[i * 4 + 1];
        let b = rgba[i * 4 + 2];
        let r = if apply_lut { lut[r as usize] } else { r } as f32;
        let g = if apply_lut { lut[g as usize] } else { g } as f32;
        let b = if apply_lut { lut[b as usize] } else { b } as f32;
        gray[i] = (0.299 * r + 0.587 * g + 0.114 * b).round().clamp(0.0, 255.0) as u8;
    }

    let gray_b = if p.blur > 0 {
        box_blur(&gray, w, h, p.blur as usize)
    } else {
        gray.clone()
    };

    let mut out = vec![255u8; n];

    match p.mode.as_str() {
        "threshold" => {
            apply_threshold(&gray_b, &mut out, p.threshold);
        }
        "edge" => {
            apply_edge(&gray_b, &mut out, w, h, p.edge_str);
            apply_line_width_dilation(&mut out, w, h, p.line_width);
        }
        "both" => {
            let mut t = vec![255u8; n];
            let mut e = vec![255u8; n];
            apply_threshold(&gray_b, &mut t, p.threshold);
            apply_edge(&gray_b, &mut e, w, h, p.edge_str);
            apply_line_width_dilation(&mut e, w, h, p.line_width);
            for i in 0..n { out[i] = if e[i] == 0 { 0 } else { t[i] }; }
        }
        "adaptive" => {
            apply_adaptive_threshold(&gray_b, &mut out, w, h, p.adapt_block, p.adapt_c);
            apply_line_width_dilation(&mut out, w, h, p.line_width);
            apply_line_thin(&mut out, w, h, p.line_width);
            if p.thin_noise > 0 { apply_noise_remove(&mut out, w, h, p.thin_noise as i32); }
        }
        "thinning" => {
            apply_adaptive_threshold(&gray_b, &mut out, w, h, p.adapt_block, p.adapt_c);
            zhang_suen_thinning(&mut out, w, h);
            apply_line_width_dilation(&mut out, w, h, p.line_width);
            apply_line_thin(&mut out, w, h, p.line_width);
            if p.thin_noise > 0 { apply_noise_remove(&mut out, w, h, p.thin_noise as i32); }
        }
        "scan" => {
            apply_scan_pipeline(&gray, &mut out, w, h, p.scan_bg, p.scan_contrast, p.scan_thin, p.adapt_block, p.adapt_c, p.blur);
            apply_line_width_dilation(&mut out, w, h, p.line_width);
            apply_line_thin(&mut out, w, h, p.line_width);
            if p.thin_noise > 0 { apply_noise_remove(&mut out, w, h, p.thin_noise as i32); }
        }
        _ => {
            apply_threshold(&gray_b, &mut out, p.threshold);
        }
    }

    if p.invert {
        for v in out.iter_mut() { *v = 255u8.saturating_sub(*v); }
    }

    out
}

fn apply_threshold(gray: &[u8], out: &mut [u8], thr: u8) {
    for (i, g) in gray.iter().enumerate() {
        out[i] = if *g >= thr { 255 } else { 0 };
    }
}

fn apply_edge(gray: &[u8], out: &mut [u8], w: usize, h: usize, edge_str: u16) {
    let strf = edge_str.max(1) as i32;
    let thr = (80 * 100 / strf) as i32;
    for y in 1..h-1 {
        let row_u = (y - 1) * w;
        let row = y * w;
        let row_d = (y + 1) * w;
        for x in 1..w-1 {
            let gx =
                -(gray[row_u + x - 1] as i32) - 2 * (gray[row + x - 1] as i32) - (gray[row_d + x - 1] as i32)
                + (gray[row_u + x + 1] as i32) + 2 * (gray[row + x + 1] as i32) + (gray[row_d + x + 1] as i32);
            let gy =
                -(gray[row_u + x - 1] as i32) - 2 * (gray[row_u + x] as i32) - (gray[row_u + x + 1] as i32)
                + (gray[row_d + x - 1] as i32) + 2 * (gray[row_d + x] as i32) + (gray[row_d + x + 1] as i32);
            let val = gx.abs() + gy.abs();
            out[row + x] = if val > thr { 0 } else { 255 };
        }
    }
    for x in 0..w { out[x] = 255; out[(h - 1) * w + x] = 255; }
    for y in 0..h { out[y * w] = 255; out[y * w + w - 1] = 255; }
}

fn box_blur(gray: &[u8], w: usize, h: usize, r: usize) -> Vec<u8> {
    if r == 0 { return gray.to_vec(); }
    let mut tmp = vec![0f32; w * h];
    for y in 0..h {
        let mut sum = 0f32;
        let max_x = (r).min(w - 1);
        for x in 0..=max_x { sum += gray[y * w + x] as f32; }
        for x in 0..w {
            let xr = x + r + 1;
            let xl = if x > r { x - r - 1 } else { usize::MAX };
            if xr < w { sum += gray[y * w + xr] as f32; }
            if xl != usize::MAX { sum -= gray[y * w + xl] as f32; }
            let x0 = if x > r { x - r } else { 0 };
            let x1 = (x + r).min(w - 1);
            let cnt = (x1 - x0 + 1) as f32;
            tmp[y * w + x] = sum / cnt;
        }
    }
    let mut out = vec![0u8; w * h];
    for x in 0..w {
        let mut sum = 0f32;
        let max_y = (r).min(h - 1);
        for y in 0..=max_y { sum += tmp[y * w + x]; }
        for y in 0..h {
            let yr = y + r + 1;
            let yl = if y > r { y - r - 1 } else { usize::MAX };
            if yr < h { sum += tmp[yr * w + x]; }
            if yl != usize::MAX { sum -= tmp[yl * w + x]; }
            let y0 = if y > r { y - r } else { 0 };
            let y1 = (y + r).min(h - 1);
            let cnt = (y1 - y0 + 1) as f32;
            out[y * w + x] = (sum / cnt).round().clamp(0.0, 255.0) as u8;
        }
    }
    out
}

fn apply_adaptive_threshold(gray: &[u8], out: &mut [u8], w: usize, h: usize, block: u8, c: i16) {
    let mut blk = block | 1;
    if blk < 3 { blk = 3; }
    let blk = blk as usize;
    let mut intg = vec![0f64; (w + 1) * (h + 1)];
    for y in 0..h {
        for x in 0..w {
            let idx = (y + 1) * (w + 1) + (x + 1);
            intg[idx] = gray[y * w + x] as f64
                + intg[y * (w + 1) + (x + 1)]
                + intg[(y + 1) * (w + 1) + x]
                - intg[y * (w + 1) + x];
        }
    }
    let half = blk / 2;
    for y in 0..h {
        for x in 0..w {
            let x0 = if x > half { x - half } else { 0 };
            let y0 = if y > half { y - half } else { 0 };
            let x1 = (x + half).min(w - 1);
            let y1 = (y + half).min(h - 1);
            let area = ((x1 - x0 + 1) * (y1 - y0 + 1)) as f64;
            let sum = intg[(y1 + 1) * (w + 1) + (x1 + 1)]
                - intg[y0 * (w + 1) + (x1 + 1)]
                - intg[(y1 + 1) * (w + 1) + x0]
                + intg[y0 * (w + 1) + x0];
            let mean = sum / area;
            let thr = mean - c as f64;
            out[y * w + x] = if (gray[y * w + x] as f64) < thr { 0 } else { 255 };
        }
    }
}

fn apply_line_width_dilation(out: &mut [u8], w: usize, h: usize, line_width: u8) {
    let r = line_width as i32;
    if r <= 10 { return; }
    let ri = ((r - 10) as f32 / 10.0).round() as i32;
    if ri < 1 { return; }
    let mut tmp = vec![0u8; w * h];
    for y in 0..h {
        for x in 0..w {
            if out[y * w + x] != 0 { continue; }
            let x0 = (x as i32 - ri).max(0) as usize;
            let x1 = (x as i32 + ri).min((w - 1) as i32) as usize;
            for nx in x0..=x1 { tmp[y * w + nx] = 1; }
        }
    }
    for x in 0..w {
        for y in 0..h {
            if tmp[y * w + x] == 0 { continue; }
            let y0 = (y as i32 - ri).max(0) as usize;
            let y1 = (y as i32 + ri).min((h - 1) as i32) as usize;
            for ny in y0..=y1 { out[ny * w + x] = 0; }
        }
    }
}

fn apply_line_thin(out: &mut [u8], w: usize, h: usize, line_width: u8) {
    let r = line_width as i32;
    if r >= 10 { return; }
    let iter = 10 - r;
    for _ in 0..iter {
        let src = out.to_vec();
        for y in 1..h-1 {
            let row = y * w;
            for x in 1..w-1 {
                if src[row + x] != 0 { continue; }
                if src[row + x - w] == 255 || src[row + x + w] == 255 || src[row + x - 1] == 255 || src[row + x + 1] == 255 {
                    out[row + x] = 255;
                }
            }
        }
    }
}

fn zhang_suen_thinning(out: &mut [u8], w: usize, h: usize) {
    let n = w * h;
    let mut bin = vec![0u8; n];
    for i in 0..n { bin[i] = if out[i] == 0 { 1 } else { 0 }; }

    let mut candidates: Vec<usize> = Vec::new();
    for y in 1..h-1 {
        for x in 1..w-1 {
            if bin[y * w + x] != 0 { candidates.push(y * w + x); }
        }
    }

    let max_iter = 200;
    for _ in 0..max_iter {
        if candidates.is_empty() { break; }
        let mut del1: Vec<usize> = Vec::new();
        let mut del2: Vec<usize> = Vec::new();

        for &i in &candidates {
            let x = i % w;
            let y = i / w;
            if x < 1 || x >= w - 1 || y < 1 || y >= h - 1 { continue; }
            let p2 = bin[i - w];
            let p3 = bin[i - w + 1];
            let p4 = bin[i + 1];
            let p5 = bin[i + w + 1];
            let p6 = bin[i + w];
            let p7 = bin[i + w - 1];
            let p8 = bin[i - 1];
            let p9 = bin[i - w - 1];
            let b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
            if b < 2 || b > 6 { continue; }
            let a = (p2 == 0 && p3 == 1) as u8 + (p3 == 0 && p4 == 1) as u8 +
                    (p4 == 0 && p5 == 1) as u8 + (p5 == 0 && p6 == 1) as u8 +
                    (p6 == 0 && p7 == 1) as u8 + (p7 == 0 && p8 == 1) as u8 +
                    (p8 == 0 && p9 == 1) as u8 + (p9 == 0 && p2 == 1) as u8;
            if a != 1 { continue; }
            if p2 * p4 * p6 != 0 { continue; }
            if p4 * p6 * p8 != 0 { continue; }
            del1.push(i);
        }
        for &i in &del1 { bin[i] = 0; }

        for &i in &candidates {
            let x = i % w;
            let y = i / w;
            if x < 1 || x >= w - 1 || y < 1 || y >= h - 1 { continue; }
            let p2 = bin[i - w];
            let p3 = bin[i - w + 1];
            let p4 = bin[i + 1];
            let p5 = bin[i + w + 1];
            let p6 = bin[i + w];
            let p7 = bin[i + w - 1];
            let p8 = bin[i - 1];
            let p9 = bin[i - w - 1];
            let b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
            if b < 2 || b > 6 { continue; }
            let a = (p2 == 0 && p3 == 1) as u8 + (p3 == 0 && p4 == 1) as u8 +
                    (p4 == 0 && p5 == 1) as u8 + (p5 == 0 && p6 == 1) as u8 +
                    (p6 == 0 && p7 == 1) as u8 + (p7 == 0 && p8 == 1) as u8 +
                    (p8 == 0 && p9 == 1) as u8 + (p9 == 0 && p2 == 1) as u8;
            if a != 1 { continue; }
            if p2 * p4 * p8 != 0 { continue; }
            if p2 * p6 * p8 != 0 { continue; }
            del2.push(i);
        }
        for &i in &del2 { bin[i] = 0; }

        if del1.is_empty() && del2.is_empty() { break; }

        // keep only remaining black pixels as candidates
        candidates.retain(|&i| bin[i] != 0);
    }

    for i in 0..n { out[i] = if bin[i] != 0 { 0 } else { 255 }; }
}

fn apply_noise_remove(out: &mut [u8], w: usize, h: usize, min_neighbors: i32) {
    let tmp = out.to_vec();
    for y in 1..h-1 {
        let row = y * w;
        let row_u = row - w;
        let row_d = row + w;
        for x in 1..w-1 {
            if tmp[row + x] != 0 { continue; }
            let mut cnt = 0;
            if tmp[row_u + x - 1] == 0 { cnt += 1; }
            if tmp[row_u + x] == 0 { cnt += 1; }
            if tmp[row_u + x + 1] == 0 { cnt += 1; }
            if tmp[row + x - 1] == 0 { cnt += 1; }
            if tmp[row + x + 1] == 0 { cnt += 1; }
            if tmp[row_d + x - 1] == 0 { cnt += 1; }
            if tmp[row_d + x] == 0 { cnt += 1; }
            if tmp[row_d + x + 1] == 0 { cnt += 1; }
            if cnt < min_neighbors { out[row + x] = 255; }
        }
    }
}

fn apply_scan_pipeline(gray: &[u8], out: &mut [u8], w: usize, h: usize, scan_bg: u8, scan_contrast: u8, scan_thin: u8, adapt_block: u8, adapt_c: i16, blur_r: u8) {
    let bg_radius = scan_bg as usize;
    let contrast_x = scan_contrast as f32 / 10.0;

    let bg = box_blur(gray, w, h, bg_radius);

    // normalize
    let mut normalized = vec![0u8; w * h];
    for i in 0..w*h {
        let bg_val = bg[i].max(1);
        let val = ((gray[i] as f32 / bg_val as f32) * 255.0).round().min(255.0);
        normalized[i] = val as u8;
    }

    // stretch + contrast
    let mut min_v = 255u8;
    let mut max_v = 0u8;
    for &v in &normalized {
        if v < min_v { min_v = v; }
        if v > max_v { max_v = v; }
    }
    let range = (max_v as i32 - min_v as i32).max(1) as f32;
    let mut stretched = vec![0u8; w * h];
    for i in 0..w*h {
        let v = ((normalized[i] as f32 - min_v as f32) / range) * 255.0;
        let v = (128.0 + (v - 128.0) * contrast_x).round();
        stretched[i] = v.clamp(0.0, 255.0) as u8;
    }

    let pre_blur = if blur_r > 0 { box_blur(&stretched, w, h, blur_r as usize) } else { stretched };
    apply_adaptive_threshold(&pre_blur, out, w, h, adapt_block, adapt_c);
    if scan_thin == 1 { zhang_suen_thinning(out, w, h); }
}
