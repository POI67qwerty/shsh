use wasm_bindgen::prelude::*;
use serde::Deserialize;

#[derive(Deserialize)]
struct AutoParams {
    gap: u8,
    min_size: u32,
    alpha: u8,
    fill_holes: bool,
    palette: Vec<[u8;3]>,
}

#[wasm_bindgen]
pub fn auto_fill(line_map: &[u8], w: u32, h: u32, params: JsValue) -> Vec<u8> {
    let p: AutoParams = serde_wasm_bindgen::from_value(params).unwrap();
    let w = w as usize;
    let h = h as usize;
    let n = w * h;

    let barrier = if p.gap > 0 { dilate_binary(line_map, w, h, p.gap as usize) } else { line_map.to_vec() };

    let mut label = vec![-1i32; n];
    let mut sizes: Vec<u32> = Vec::new();
    let mut num_labels = 0i32;

    for i in 0..n {
        if label[i] != -1 || barrier[i] != 0 { continue; }
        let lbl = num_labels;
        num_labels += 1;
        let mut q = vec![i];
        label[i] = lbl;
        let mut qi = 0usize;
        let mut size = 0u32;
        while qi < q.len() {
            let idx = q[qi]; qi += 1; size += 1;
            let x = idx % w; let y = idx / w;
            let nb = [
                if y > 0 { idx - w } else { n },
                if y + 1 < h { idx + w } else { n },
                if x > 0 { idx - 1 } else { n },
                if x + 1 < w { idx + 1 } else { n },
            ];
            for &ni in &nb {
                if ni == n { continue; }
                if label[ni] != -1 || barrier[ni] != 0 { continue; }
                label[ni] = lbl; q.push(ni);
            }
        }
        sizes.push(size);
    }

    // allocate colors
    let mut col_assign: Vec<Option<[u8;3]>> = vec![None; sizes.len()];
    let mut palette_i = 0usize;
    for (i, sz) in sizes.iter().enumerate() {
        if *sz < p.min_size { continue; }
        if p.palette.is_empty() { break; }
        col_assign[i] = Some(p.palette[palette_i % p.palette.len()]);
        palette_i += 1;
    }

    // build rgba out
    let mut out = vec![0u8; n * 4];
    for i in 0..n {
        let lbl = label[i];
        if lbl < 0 { continue; }
        let lbl = lbl as usize;
        let col = match col_assign[lbl] { Some(c) => c, None => continue };
        out[i * 4] = col[0];
        out[i * 4 + 1] = col[1];
        out[i * 4 + 2] = col[2];
        out[i * 4 + 3] = p.alpha;
    }

    if p.fill_holes {
        fill_holes(&mut out, &barrier, w, h, p.alpha);
    }

    // expand colors into line pixels to reduce white gaps
    if p.gap > 0 {
        expand_colors(&mut out, w, h, p.gap as usize);
    }

    out
}

fn dilate_binary(map: &[u8], w: usize, h: usize, r: usize) -> Vec<u8> {
    let mut tmp = vec![0u8; w * h];
    for y in 0..h {
        for x in 0..w {
            if map[y * w + x] == 0 { continue; }
            let x0 = x.saturating_sub(r);
            let x1 = (x + r).min(w - 1);
            for nx in x0..=x1 { tmp[y * w + nx] = 1; }
        }
    }
    let mut out = vec![0u8; w * h];
    for y in 0..h {
        for x in 0..w {
            if tmp[y * w + x] == 0 { continue; }
            let y0 = y.saturating_sub(r);
            let y1 = (y + r).min(h - 1);
            for ny in y0..=y1 { out[ny * w + x] = 1; }
        }
    }
    out
}

fn fill_holes(out: &mut [u8], barrier: &[u8], w: usize, h: usize, alpha: u8) {
    let n = w * h;
    let mut visited = vec![false; n];
    let mut q: Vec<usize> = Vec::new();

    // push borders as background
    for x in 0..w {
        let top = x; let bottom = (h - 1) * w + x;
        if barrier[top] == 0 { visited[top] = true; q.push(top); }
        if barrier[bottom] == 0 { visited[bottom] = true; q.push(bottom); }
    }
    for y in 0..h {
        let left = y * w; let right = y * w + (w - 1);
        if barrier[left] == 0 { visited[left] = true; q.push(left); }
        if barrier[right] == 0 { visited[right] = true; q.push(right); }
    }

    let mut qi = 0usize;
    while qi < q.len() {
        let idx = q[qi]; qi += 1;
        let x = idx % w; let y = idx / w;
        let nb = [
            if y > 0 { idx - w } else { n },
            if y + 1 < h { idx + w } else { n },
            if x > 0 { idx - 1 } else { n },
            if x + 1 < w { idx + 1 } else { n },
        ];
        for &ni in &nb {
            if ni == n { continue; }
            if visited[ni] || barrier[ni] != 0 { continue; }
            visited[ni] = true; q.push(ni);
        }
    }

    // any non-visited & non-barrier is a hole -> fill with nearest color by scanning neighbors
    for i in 0..n {
        if barrier[i] != 0 || visited[i] { continue; }
        // find a neighboring color (simple 4-neighbor search)
        let x = i % w; let y = i / w;
        let mut found = None;
        let nb = [
            if y > 0 { i - w } else { n },
            if y + 1 < h { i + w } else { n },
            if x > 0 { i - 1 } else { n },
            if x + 1 < w { i + 1 } else { n },
        ];
        for &ni in &nb {
            if ni == n { continue; }
            if out[ni * 4 + 3] > 0 { found = Some(ni); break; }
        }
        if let Some(ni) = found {
            out[i * 4] = out[ni * 4];
            out[i * 4 + 1] = out[ni * 4 + 1];
            out[i * 4 + 2] = out[ni * 4 + 2];
            out[i * 4 + 3] = alpha;
        }
    }
}

fn expand_colors(out: &mut [u8], w: usize, h: usize, r: usize) {
    if r == 0 { return; }
    let n = w * h;
    // horizontal dilation
    let mut tmp = vec![0u8; n * 4];
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            let a = out[i * 4 + 3];
            if a == 0 { continue; }
            let x0 = x.saturating_sub(r);
            let x1 = (x + r).min(w - 1);
            for nx in x0..=x1 {
                let ni = y * w + nx;
                if tmp[ni * 4 + 3] == 0 {
                    tmp[ni * 4] = out[i * 4];
                    tmp[ni * 4 + 1] = out[i * 4 + 1];
                    tmp[ni * 4 + 2] = out[i * 4 + 2];
                    tmp[ni * 4 + 3] = out[i * 4 + 3];
                }
            }
        }
    }
    // vertical dilation
    for x in 0..w {
        for y in 0..h {
            let i = y * w + x;
            if tmp[i * 4 + 3] == 0 { continue; }
            let y0 = y.saturating_sub(r);
            let y1 = (y + r).min(h - 1);
            for ny in y0..=y1 {
                let ni = ny * w + x;
                if out[ni * 4 + 3] == 0 {
                    out[ni * 4] = tmp[i * 4];
                    out[ni * 4 + 1] = tmp[i * 4 + 1];
                    out[ni * 4 + 2] = tmp[i * 4 + 2];
                    out[ni * 4 + 3] = tmp[i * 4 + 3];
                }
            }
        }
    }
}

#[wasm_bindgen]
pub fn bfs_fill(seeds: &[u32], barrier: &[u8], w: u32, h: u32) -> Vec<u8> {
    let w = w as usize; let h = h as usize; let n = w * h;
    let mut mask = vec![0u8; n];
    let mut q: Vec<usize> = Vec::new();
    for &s in seeds {
        let i = s as usize;
        if i >= n { continue; }
        if barrier[i] != 0 || mask[i] != 0 { continue; }
        mask[i] = 1; q.push(i);
    }
    let mut qi = 0usize;
    while qi < q.len() {
        let idx = q[qi]; qi += 1;
        let x = idx % w; let y = idx / w;
        let nb = [
            if y > 0 { idx - w } else { n },
            if y + 1 < h { idx + w } else { n },
            if x > 0 { idx - 1 } else { n },
            if x + 1 < w { idx + 1 } else { n },
        ];
        for &ni in &nb {
            if ni == n { continue; }
            if mask[ni] != 0 || barrier[ni] != 0 { continue; }
            mask[ni] = 1; q.push(ni);
        }
    }
    mask
}

#[wasm_bindgen]
pub fn find_small_components(bin: &[u8], w: u32, h: u32, max_area: u32, max_thin: u32) -> Vec<u8> {
    let w = w as usize; let h = h as usize; let n = w * h;
    let mut label = vec![-1i32; n];
    let mut sizes: Vec<u32> = Vec::new();
    let mut bboxes: Vec<(usize,usize,usize,usize)> = Vec::new();

    for i in 0..n {
        if bin[i] == 0 || label[i] >= 0 { continue; }
        let lbl = sizes.len() as i32;
        label[i] = lbl;
        let mut q = vec![i]; let mut qi = 0usize; let mut sz = 0u32;
        let mut minx = w; let mut miny = h; let mut maxx = 0usize; let mut maxy = 0usize;
        while qi < q.len() {
            let idx = q[qi]; qi += 1; sz += 1;
            let x = idx % w; let y = idx / w;
            if x < minx { minx = x; } if x > maxx { maxx = x; }
            if y < miny { miny = y; } if y > maxy { maxy = y; }
            let nb = [
                if y > 0 { idx - w } else { n },
                if y + 1 < h { idx + w } else { n },
                if x > 0 { idx - 1 } else { n },
                if x + 1 < w { idx + 1 } else { n },
            ];
            for &ni in &nb {
                if ni == n { continue; }
                if bin[ni] == 0 || label[ni] >= 0 { continue; }
                label[ni] = lbl; q.push(ni);
            }
        }
        sizes.push(sz);
        bboxes.push((minx, miny, maxx, maxy));
    }

    let mut remove = vec![0u8; sizes.len()];
    for (i, sz) in sizes.iter().enumerate() {
        let (x0, y0, x1, y1) = bboxes[i];
        let bw = x1 - x0 + 1;
        let bh = y1 - y0 + 1;
        if *sz <= max_area { remove[i] = 1; continue; }
        if max_thin > 0 && bw.min(bh) as u32 <= max_thin { remove[i] = 1; }
    }

    let mut out = vec![0u8; n];
    for i in 0..n {
        if bin[i] != 0 {
            let lbl = label[i];
            if lbl >= 0 && remove[lbl as usize] == 0 { out[i] = 1; }
        }
    }
    out
}
