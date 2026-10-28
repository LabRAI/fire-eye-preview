"use strict";
var FireMatch = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // app/src/lib/browser/fireMatch.ts
  var fireMatch_exports = {};
  __export(fireMatch_exports, {
    calculateFireMatch: () => calculateFireMatch,
    toHeatmapCell: () => toHeatmapCell
  });

  // app/node_modules/flatqueue/index.js
  var FlatQueue = class {
    constructor() {
      this.ids = [];
      this.values = [];
      this.length = 0;
    }
    /** Removes all items from the queue. */
    clear() {
      this.length = 0;
    }
    /**
     * Adds `item` to the queue with the specified `priority`.
     *
     * `priority` must be a number. Items are sorted and returned from low to high priority. Multiple items
     * with the same priority value can be added to the queue, but there is no guaranteed order between these items.
     *
     * @param {T} item
     * @param {number} priority
     */
    push(item, priority) {
      let pos = this.length++;
      while (pos > 0) {
        const parent = pos - 1 >> 1;
        const parentValue = this.values[parent];
        if (priority >= parentValue) break;
        this.ids[pos] = this.ids[parent];
        this.values[pos] = parentValue;
        pos = parent;
      }
      this.ids[pos] = item;
      this.values[pos] = priority;
    }
    /**
     * Removes and returns the item from the head of this queue, which is one of
     * the items with the lowest priority. If this queue is empty, returns `undefined`.
     */
    pop() {
      if (this.length === 0) return void 0;
      const ids = this.ids, values = this.values, top = ids[0], last = --this.length;
      if (last > 0) {
        const id = ids[last];
        const value = values[last];
        let pos = 0;
        const halfLen = last >> 1;
        while (pos < halfLen) {
          const left = (pos << 1) + 1;
          const right = left + 1;
          const child = left + (+(right < last) & +(values[right] < values[left]));
          if (values[child] >= value) break;
          ids[pos] = ids[child];
          values[pos] = values[child];
          pos = child;
        }
        ids[pos] = id;
        values[pos] = value;
      }
      return top;
    }
    /** Returns the item from the head of this queue without removing it. If this queue is empty, returns `undefined`. */
    peek() {
      return this.length > 0 ? this.ids[0] : void 0;
    }
    /**
     * Returns the priority value of the item at the head of this queue without
     * removing it. If this queue is empty, returns `undefined`.
     */
    peekValue() {
      return this.length > 0 ? this.values[0] : void 0;
    }
    /**
     * Shrinks the internal arrays to `this.length`.
     *
     * `pop()` and `clear()` calls don't free memory automatically to avoid unnecessary resize operations.
     * This also means that items that have been added to the queue can't be garbage collected until
     * a new item is pushed in their place, or this method is called.
     */
    shrink() {
      this.ids.length = this.values.length = this.length;
    }
  };

  // app/node_modules/flatbush/index.js
  var ARRAY_TYPES = [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array];
  var VERSION = 3;
  var Flatbush = class _Flatbush {
    /**
     * Recreate a Flatbush index from raw `ArrayBuffer` or `SharedArrayBuffer` data.
     * @param {ArrayBufferLike} data
     * @param {number} [byteOffset=0] byte offset to the start of the Flatbush buffer in the referenced ArrayBuffer.
     * @returns {Flatbush} index
     */
    static from(data, byteOffset = 0) {
      if (byteOffset % 8 !== 0) {
        throw new Error("byteOffset must be 8-byte aligned.");
      }
      if (!data || data.byteLength === void 0 || data.buffer) {
        throw new Error("Data must be an instance of ArrayBuffer or SharedArrayBuffer.");
      }
      const [magic, versionAndType] = new Uint8Array(data, byteOffset + 0, 2);
      if (magic !== 251) {
        throw new Error("Data does not appear to be in a Flatbush format.");
      }
      const version = versionAndType >> 4;
      if (version !== VERSION) {
        throw new Error(`Got v${version} data when expected v${VERSION}.`);
      }
      const ArrayType = ARRAY_TYPES[versionAndType & 15];
      if (!ArrayType) {
        throw new Error("Unrecognized array type.");
      }
      const [nodeSize] = new Uint16Array(data, byteOffset + 2, 1);
      const [numItems] = new Uint32Array(data, byteOffset + 4, 1);
      return new _Flatbush(numItems, nodeSize, ArrayType, void 0, data, byteOffset);
    }
    /**
     * Create a Flatbush index that will hold a given number of items.
     * @param {number} numItems
     * @param {number} [nodeSize=16] Size of the tree node (16 by default).
     * @param {TypedArrayConstructor} [ArrayType=Float64Array] The array type used for coordinates storage (`Float64Array` by default).
     * @param {ArrayBufferConstructor | SharedArrayBufferConstructor} [ArrayBufferType=ArrayBuffer] The array buffer type used to store data (`ArrayBuffer` by default).
     * @param {ArrayBufferLike} [data] (Only used internally)
     * @param {number} [byteOffset=0] (Only used internally)
     */
    constructor(numItems, nodeSize = 16, ArrayType = Float64Array, ArrayBufferType = ArrayBuffer, data, byteOffset = 0) {
      if (numItems === void 0) throw new Error("Missing required argument: numItems.");
      if (isNaN(numItems) || numItems <= 0) throw new Error(`Unexpected numItems value: ${numItems}.`);
      this.numItems = +numItems;
      this.nodeSize = Math.min(Math.max(+nodeSize, 2), 65535);
      this.byteOffset = byteOffset;
      let n = numItems;
      let numNodes = n;
      this._levelBounds = [n * 4];
      do {
        n = Math.ceil(n / this.nodeSize);
        numNodes += n;
        this._levelBounds.push(numNodes * 4);
      } while (n !== 1);
      this.ArrayType = ArrayType;
      this.IndexArrayType = numNodes < 16384 ? Uint16Array : Uint32Array;
      const arrayTypeIndex = ARRAY_TYPES.indexOf(ArrayType);
      const nodesByteSize = numNodes * 4 * ArrayType.BYTES_PER_ELEMENT;
      if (arrayTypeIndex < 0) {
        throw new Error(`Unexpected typed array class: ${ArrayType}.`);
      }
      if (data) {
        this.data = data;
        this._boxes = new ArrayType(data, byteOffset + 8, numNodes * 4);
        this._indices = new this.IndexArrayType(data, byteOffset + 8 + nodesByteSize, numNodes);
        this._pos = numNodes * 4;
        this.minX = this._boxes[this._pos - 4];
        this.minY = this._boxes[this._pos - 3];
        this.maxX = this._boxes[this._pos - 2];
        this.maxY = this._boxes[this._pos - 1];
      } else {
        const data2 = this.data = new ArrayBufferType(8 + nodesByteSize + numNodes * this.IndexArrayType.BYTES_PER_ELEMENT);
        this._boxes = new ArrayType(data2, 8, numNodes * 4);
        this._indices = new this.IndexArrayType(data2, 8 + nodesByteSize, numNodes);
        this._pos = 0;
        this.minX = Infinity;
        this.minY = Infinity;
        this.maxX = -Infinity;
        this.maxY = -Infinity;
        new Uint8Array(data2, 0, 2).set([251, (VERSION << 4) + arrayTypeIndex]);
        new Uint16Array(data2, 2, 1)[0] = nodeSize;
        new Uint32Array(data2, 4, 1)[0] = numItems;
      }
      this._queue = new FlatQueue();
    }
    /**
     * Add a given rectangle to the index.
     * @param {number} minX
     * @param {number} minY
     * @param {number} maxX
     * @param {number} maxY
     * @returns {number} A zero-based, incremental number that represents the newly added rectangle.
     */
    add(minX, minY, maxX = minX, maxY = minY) {
      const index = this._pos >> 2;
      const boxes = this._boxes;
      this._indices[index] = index;
      boxes[this._pos++] = minX;
      boxes[this._pos++] = minY;
      boxes[this._pos++] = maxX;
      boxes[this._pos++] = maxY;
      if (minX < this.minX) this.minX = minX;
      if (minY < this.minY) this.minY = minY;
      if (maxX > this.maxX) this.maxX = maxX;
      if (maxY > this.maxY) this.maxY = maxY;
      return index;
    }
    /** Perform indexing of the added rectangles. */
    finish() {
      if (this._pos >> 2 !== this.numItems) {
        throw new Error(`Added ${this._pos >> 2} items when expected ${this.numItems}.`);
      }
      const boxes = this._boxes;
      if (this.numItems <= this.nodeSize) {
        boxes[this._pos++] = this.minX;
        boxes[this._pos++] = this.minY;
        boxes[this._pos++] = this.maxX;
        boxes[this._pos++] = this.maxY;
        return;
      }
      const width = this.maxX - this.minX || 1;
      const height = this.maxY - this.minY || 1;
      const hilbertValues = new Uint32Array(this.numItems);
      const hilbertMax = (1 << 16) - 1;
      for (let i = 0, pos = 0; i < this.numItems; i++) {
        const minX = boxes[pos++];
        const minY = boxes[pos++];
        const maxX = boxes[pos++];
        const maxY = boxes[pos++];
        const x = Math.floor(hilbertMax * ((minX + maxX) / 2 - this.minX) / width);
        const y = Math.floor(hilbertMax * ((minY + maxY) / 2 - this.minY) / height);
        hilbertValues[i] = hilbert(x, y);
      }
      sort(hilbertValues, boxes, this._indices, 0, this.numItems - 1, this.nodeSize);
      for (let i = 0, pos = 0; i < this._levelBounds.length - 1; i++) {
        const end = this._levelBounds[i];
        while (pos < end) {
          const nodeIndex = pos;
          let nodeMinX = boxes[pos++];
          let nodeMinY = boxes[pos++];
          let nodeMaxX = boxes[pos++];
          let nodeMaxY = boxes[pos++];
          for (let j = 1; j < this.nodeSize && pos < end; j++) {
            nodeMinX = Math.min(nodeMinX, boxes[pos++]);
            nodeMinY = Math.min(nodeMinY, boxes[pos++]);
            nodeMaxX = Math.max(nodeMaxX, boxes[pos++]);
            nodeMaxY = Math.max(nodeMaxY, boxes[pos++]);
          }
          this._indices[this._pos >> 2] = nodeIndex;
          boxes[this._pos++] = nodeMinX;
          boxes[this._pos++] = nodeMinY;
          boxes[this._pos++] = nodeMaxX;
          boxes[this._pos++] = nodeMaxY;
        }
      }
    }
    /**
     * Search the index by a bounding box.
     * @param {number} minX
     * @param {number} minY
     * @param {number} maxX
     * @param {number} maxY
     * @param {(index: number, x0: number, y0: number, x1: number, y1: number) => boolean} [filterFn] An optional function that is called on every found item; if supplied, only items for which this function returns true will be included in the results array.
     * @returns {number[]} An array of indices of items intersecting or touching the given bounding box.
     */
    search(minX, minY, maxX, maxY, filterFn) {
      if (this._pos !== this._boxes.length) {
        throw new Error("Data not yet indexed - call index.finish().");
      }
      let nodeIndex = this._boxes.length - 4;
      const queue = [];
      const results = [];
      while (nodeIndex !== void 0) {
        const end = Math.min(nodeIndex + this.nodeSize * 4, upperBound(nodeIndex, this._levelBounds));
        for (let pos = nodeIndex; pos < end; pos += 4) {
          const x0 = this._boxes[pos];
          if (maxX < x0) continue;
          const y0 = this._boxes[pos + 1];
          if (maxY < y0) continue;
          const x1 = this._boxes[pos + 2];
          if (minX > x1) continue;
          const y1 = this._boxes[pos + 3];
          if (minY > y1) continue;
          const index = this._indices[pos >> 2] | 0;
          if (nodeIndex >= this.numItems * 4) {
            queue.push(index);
          } else if (filterFn === void 0 || filterFn(index, x0, y0, x1, y1)) {
            results.push(index);
          }
        }
        nodeIndex = queue.pop();
      }
      return results;
    }
    /**
     * Search items in order of distance from the given point.
     * @param {number} x
     * @param {number} y
     * @param {number} [maxResults=Infinity]
     * @param {number} [maxDistance=Infinity]
     * @param {(index: number) => boolean} [filterFn] An optional function for filtering the results.
     * @returns {number[]} An array of indices of items found.
     */
    neighbors(x, y, maxResults = Infinity, maxDistance = Infinity, filterFn) {
      if (this._pos !== this._boxes.length) {
        throw new Error("Data not yet indexed - call index.finish().");
      }
      let nodeIndex = this._boxes.length - 4;
      const q = this._queue;
      const results = [];
      const maxDistSquared = maxDistance * maxDistance;
      outer: while (nodeIndex !== void 0) {
        const end = Math.min(nodeIndex + this.nodeSize * 4, upperBound(nodeIndex, this._levelBounds));
        for (let pos = nodeIndex; pos < end; pos += 4) {
          const index = this._indices[pos >> 2] | 0;
          const minX = this._boxes[pos];
          const minY = this._boxes[pos + 1];
          const maxX = this._boxes[pos + 2];
          const maxY = this._boxes[pos + 3];
          const dx = x < minX ? minX - x : x > maxX ? x - maxX : 0;
          const dy = y < minY ? minY - y : y > maxY ? y - maxY : 0;
          const dist = dx * dx + dy * dy;
          if (dist > maxDistSquared) continue;
          if (nodeIndex >= this.numItems * 4) {
            q.push(index << 1, dist);
          } else if (filterFn === void 0 || filterFn(index)) {
            q.push((index << 1) + 1, dist);
          }
        }
        while (q.length && q.peek() & 1) {
          const dist = q.peekValue();
          if (dist > maxDistSquared) break outer;
          results.push(q.pop() >> 1);
          if (results.length === maxResults) break outer;
        }
        nodeIndex = q.length ? q.pop() >> 1 : void 0;
      }
      q.clear();
      return results;
    }
  };
  function upperBound(value, arr) {
    let i = 0;
    let j = arr.length - 1;
    while (i < j) {
      const m = i + j >> 1;
      if (arr[m] > value) {
        j = m;
      } else {
        i = m + 1;
      }
    }
    return arr[i];
  }
  function sort(values, boxes, indices, left, right, nodeSize) {
    const stack = [left, right];
    while (stack.length) {
      const r = stack.pop() || 0;
      const l = stack.pop() || 0;
      if (r - l <= nodeSize && Math.floor(l / nodeSize) >= Math.floor(r / nodeSize)) continue;
      const a = values[l];
      const b = values[l + r >> 1];
      const c = values[r];
      const pivot = a > b !== a > c ? a : b < a !== b < c ? b : c;
      let i = l - 1;
      let j = r + 1;
      while (true) {
        do
          i++;
        while (values[i] < pivot);
        do
          j--;
        while (values[j] > pivot);
        if (i >= j) break;
        swap(values, boxes, indices, i, j);
      }
      stack.push(l, j, j + 1, r);
    }
  }
  function swap(values, boxes, indices, i, j) {
    const temp = values[i];
    values[i] = values[j];
    values[j] = temp;
    const k = 4 * i;
    const m = 4 * j;
    const a = boxes[k];
    const b = boxes[k + 1];
    const c = boxes[k + 2];
    const d = boxes[k + 3];
    boxes[k] = boxes[m];
    boxes[k + 1] = boxes[m + 1];
    boxes[k + 2] = boxes[m + 2];
    boxes[k + 3] = boxes[m + 3];
    boxes[m] = a;
    boxes[m + 1] = b;
    boxes[m + 2] = c;
    boxes[m + 3] = d;
    const e = indices[i];
    indices[i] = indices[j];
    indices[j] = e;
  }
  function hilbert(x, y) {
    let a = x ^ y;
    let b = 65535 ^ a;
    let c = 65535 ^ (x | y);
    let d = x & (y ^ 65535);
    let A = a | b >> 1;
    let B = a >> 1 ^ a;
    let C = c >> 1 ^ b & d >> 1 ^ c;
    let D = a & c >> 1 ^ d >> 1 ^ d;
    a = A;
    b = B;
    c = C;
    d = D;
    A = a & a >> 2 ^ b & b >> 2;
    B = a & b >> 2 ^ b & (a ^ b) >> 2;
    C ^= a & c >> 2 ^ b & d >> 2;
    D ^= b & c >> 2 ^ (a ^ b) & d >> 2;
    a = A;
    b = B;
    c = C;
    d = D;
    A = a & a >> 4 ^ b & b >> 4;
    B = a & b >> 4 ^ b & (a ^ b) >> 4;
    C ^= a & c >> 4 ^ b & d >> 4;
    D ^= b & c >> 4 ^ (a ^ b) & d >> 4;
    a = A;
    b = B;
    c = C;
    d = D;
    C ^= a & c >> 8 ^ b & d >> 8;
    D ^= b & c >> 8 ^ (a ^ b) & d >> 8;
    a = C ^ C >> 1;
    b = D ^ D >> 1;
    let i0 = x ^ y;
    let i1 = b | 65535 ^ (i0 | a);
    i0 = (i0 | i0 << 8) & 16711935;
    i0 = (i0 | i0 << 4) & 252645135;
    i0 = (i0 | i0 << 2) & 858993459;
    i0 = (i0 | i0 << 1) & 1431655765;
    i1 = (i1 | i1 << 8) & 16711935;
    i1 = (i1 | i1 << 4) & 252645135;
    i1 = (i1 | i1 << 2) & 858993459;
    i1 = (i1 | i1 << 1) & 1431655765;
    return (i1 << 1 | i0) >>> 0;
  }

  // app/src/lib/browser/fireMatch.ts
  function calculateFireMatch({
    cells,
    totalCells,
    fires,
    toleranceKm
  }) {
    const index = cells.length ? new Flatbush(cells.length) : null;
    for (const cell of cells) index.add(...cell.bounds);
    index?.finish();
    let firesCovered = 0, significantCovered = 0, significant = 0;
    for (const fire of fires) {
      const isSignificant = fire.acres !== null && fire.acres >= 100;
      if (isSignificant) significant++;
      const latBuffer = toleranceKm / 111.32;
      const lngBuffer = latBuffer / Math.max(0.15, Math.cos(fire.lat * Math.PI / 180));
      const candidates = index?.search(
        fire.lng - lngBuffer,
        fire.lat - latBuffer,
        fire.lng + lngBuffer,
        fire.lat + latBuffer
      ) || [];
      const covered = candidates.some(
        (i) => cellWithinDistance([fire.lng, fire.lat], cells[i], toleranceKm)
      );
      if (covered) {
        firesCovered++;
        if (isSignificant) significantCovered++;
      }
    }
    return {
      status: totalCells ? "ready" : "waiting",
      firesInView: fires.length,
      firesCovered,
      fireCoverageRate: fires.length ? firesCovered / fires.length : null,
      significantFireCoverageRate: significant ? significantCovered / significant : null,
      forecastArea: totalCells ? cells.length / totalCells : null
    };
  }
  function toHeatmapCell(feature) {
    if (Number((feature.properties || {}).background) === 1) {
      return null;
    }
    const value = Number((feature.properties || {}).value);
    const probFire = Number((feature.properties || {}).prob_fire);
    const geometry = feature.geometry;
    if (!Number.isFinite(value) || !geometry) {
      return null;
    }
    const bounds = geometryBounds(geometry);
    if (!bounds) {
      return null;
    }
    return {
      value,
      probFire: Number.isFinite(probFire) ? probFire : null,
      geometry,
      bounds
    };
  }
  function cellWithinDistance(point, cell, toleranceKm) {
    if (!boundsWithinDistance(cell.bounds, point, toleranceKm)) {
      return false;
    }
    if (pointInGeometry(point, cell.geometry)) {
      return true;
    }
    return distanceToGeometryKm(point, cell.geometry) <= toleranceKm;
  }
  function geometryBounds(geometry) {
    const positions = [];
    if ("coordinates" in geometry) {
      collectPositions(geometry.coordinates, positions);
    } else if (geometry.type === "GeometryCollection") {
      for (const child of geometry.geometries) {
        const childBounds = geometryBounds(child);
        if (childBounds) {
          positions.push([childBounds[0], childBounds[1]], [childBounds[2], childBounds[3]]);
        }
      }
    }
    if (positions.length === 0) {
      return null;
    }
    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;
    for (const [lng, lat] of positions) {
      minLng = Math.min(minLng, lng);
      minLat = Math.min(minLat, lat);
      maxLng = Math.max(maxLng, lng);
      maxLat = Math.max(maxLat, lat);
    }
    return [minLng, minLat, maxLng, maxLat];
  }
  function collectPositions(value, positions) {
    if (!Array.isArray(value)) {
      return;
    }
    const [lng, lat] = value;
    if (typeof lng === "number" && typeof lat === "number") {
      positions.push([lng, lat]);
      return;
    }
    for (const child of value) {
      collectPositions(child, positions);
    }
  }
  function boundsWithinDistance(bounds, point, toleranceKm) {
    const latBuffer = toleranceKm / 111.32;
    const lngScale = Math.max(0.15, Math.cos(point[1] * Math.PI / 180));
    const lngBuffer = toleranceKm / (111.32 * lngScale);
    return point[0] >= bounds[0] - lngBuffer && point[0] <= bounds[2] + lngBuffer && point[1] >= bounds[1] - latBuffer && point[1] <= bounds[3] + latBuffer;
  }
  function pointInGeometry(point, geometry) {
    if (geometry.type === "Polygon") {
      return pointInPolygon(point, geometry.coordinates);
    }
    if (geometry.type === "MultiPolygon") {
      return geometry.coordinates.some((polygon) => pointInPolygon(point, polygon));
    }
    return false;
  }
  function pointInPolygon(point, polygon) {
    if (!pointInRing(point, polygon[0])) {
      return false;
    }
    for (let index = 1; index < polygon.length; index++) {
      if (pointInRing(point, polygon[index])) {
        return false;
      }
    }
    return true;
  }
  function pointInRing(point, ring) {
    let inside = false;
    const [x, y] = point;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0];
      const yi = ring[i][1];
      const xj = ring[j][0];
      const yj = ring[j][1];
      const intersects = yi > y !== yj > y && x < (xj - xi) * (y - yi) / (yj - yi) + xi;
      if (intersects) {
        inside = !inside;
      }
    }
    return inside;
  }
  function distanceToGeometryKm(point, geometry) {
    if (geometry.type === "Polygon") {
      return distanceToPolygonKm(point, geometry.coordinates);
    }
    if (geometry.type === "MultiPolygon") {
      return Math.min(...geometry.coordinates.map((polygon) => distanceToPolygonKm(point, polygon)));
    }
    if (geometry.type === "GeometryCollection") {
      return Math.min(...geometry.geometries.map((child) => distanceToGeometryKm(point, child)));
    }
    return Infinity;
  }
  function distanceToPolygonKm(point, polygon) {
    let minDistance = Infinity;
    for (const ring of polygon) {
      minDistance = Math.min(minDistance, distanceToRingKm(point, ring));
    }
    return minDistance;
  }
  function distanceToRingKm(point, ring) {
    let minDistance = Infinity;
    for (let index = 1; index < ring.length; index++) {
      minDistance = Math.min(minDistance, distanceToSegmentKm(point, ring[index - 1], ring[index]));
    }
    return minDistance;
  }
  function distanceToSegmentKm(point, start, end) {
    const lngKm = 111.32 * Math.max(0.15, Math.cos(point[1] * Math.PI / 180));
    const startX = (start[0] - point[0]) * lngKm;
    const startY = (start[1] - point[1]) * 111.32;
    const endX = (end[0] - point[0]) * lngKm;
    const endY = (end[1] - point[1]) * 111.32;
    const segmentX = endX - startX;
    const segmentY = endY - startY;
    const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY;
    if (segmentLengthSquared === 0) {
      return Math.hypot(startX, startY);
    }
    const t = Math.max(
      0,
      Math.min(1, -(startX * segmentX + startY * segmentY) / segmentLengthSquared)
    );
    const closestX = startX + t * segmentX;
    const closestY = startY + t * segmentY;
    return Math.hypot(closestX, closestY);
  }
  return __toCommonJS(fireMatch_exports);
})();
