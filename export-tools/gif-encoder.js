(function () {
    'use strict';

    function littleEndian(number) {
        return [number & 255, (number >> 8) & 255];
    }

    function colorTable() {
        const table = [];
        for (let index = 0; index < 256; index++) {
            table.push(
                Math.round(((index >> 5) & 7) * 255 / 7),
                Math.round(((index >> 2) & 7) * 255 / 7),
                Math.round((index & 3) * 255 / 3)
            );
        }
        return table;
    }

    function indexedPixels(imageData) {
        const pixels = new Uint8Array(imageData.width * imageData.height);
        for (let source = 0, target = 0; source < imageData.data.length; source += 4, target++) {
            const red = imageData.data[source] >> 5;
            const green = imageData.data[source + 1] >> 5;
            const blue = imageData.data[source + 2] >> 6;
            pixels[target] = (red << 5) | (green << 2) | blue;
        }
        return pixels;
    }

    function packedCodes(codes) {
        const bytes = [];
        let buffer = 0;
        let bitCount = 0;
        for (const { code, size } of codes) {
            buffer |= code << bitCount;
            bitCount += size;
            while (bitCount >= 8) {
                bytes.push(buffer & 255);
                buffer >>>= 8;
                bitCount -= 8;
            }
        }
        if (bitCount > 0) bytes.push(buffer & 255);
        return bytes;
    }

    function lzwCodes(pixels) {
        const codes = [{ code: 256, size: 9 }];
        let dictionary = new Map();
        let codeSize = 9;
        let nextCode = 258;
        let prefix = pixels[0];

        for (let index = 1; index < pixels.length; index++) {
            const suffix = pixels[index];
            const key = `${prefix},${suffix}`;
            if (dictionary.has(key)) {
                prefix = dictionary.get(key);
                continue;
            }
            codes.push({ code: prefix, size: codeSize });
            dictionary.set(key, nextCode++);
            if (nextCode === (1 << codeSize) && codeSize < 12) codeSize++;
            if (nextCode === 4096) {
                codes.push({ code: 256, size: codeSize });
                dictionary = new Map();
                codeSize = 9;
                nextCode = 258;
            }
            prefix = suffix;
        }
        codes.push({ code: prefix, size: codeSize }, { code: 257, size: codeSize });
        return codes;
    }

    function dataBlocks(bytes) {
        const blocks = [];
        for (let offset = 0; offset < bytes.length; offset += 255) {
            const block = bytes.slice(offset, offset + 255);
            blocks.push(block.length, ...block);
        }
        blocks.push(0);
        return blocks;
    }

    function textBytes(text) {
        return Array.from(text, (character) => character.charCodeAt(0));
    }

    function appendBytes(target, source) {
        for (const byte of source) target.push(byte);
    }

    function frameBytes(frame, width, height, delay) {
        const pixels = indexedPixels(frame);
        const compressed = packedCodes(lzwCodes(pixels));
        return [
            0x21, 0xF9, 0x04, 0x00, ...littleEndian(delay), 0x00, 0x00,
            0x2C, 0, 0, 0, 0, ...littleEndian(width), ...littleEndian(height), 0,
            8, ...dataBlocks(compressed)
        ];
    }

    function encodeGif(frames, width, height, delay) {
        const bytes = [
            ...textBytes('GIF89a'), ...littleEndian(width), ...littleEndian(height),
            0xF7, 0, 0, ...colorTable(),
            0x21, 0xFF, 0x0B, ...textBytes('NETSCAPE2.0'), 0x03, 0x01, 0, 0, 0
        ];
        frames.forEach((frame) => appendBytes(bytes, frameBytes(frame, width, height, delay)));
        bytes.push(0x3B);
        return new Blob([new Uint8Array(bytes)], { type: 'image/gif' });
    }

    globalThis.fsGifEncoder = { encodeGif };
}());
