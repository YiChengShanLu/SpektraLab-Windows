#pragma once
// Lossless, bounded host-side RAW cache. Only the LibRaw decode is stored;
// film parameters and rendering never enter this cache or change its pixels.
#include "image_io.hpp"
#include "platform.hpp"
#include <zlib.h>
#include <algorithm>
#include <array>
#include <bit>
#include <cstring>
#include <fstream>
#include <iomanip>
#include <limits>
#include <memory>
#include <sstream>
#include <stdexcept>
#include <type_traits>

namespace spkhost::decode_cache {
namespace fs = std::filesystem;
inline fs::path directory;
inline uint64_t capacity = 0, hits = 0, misses = 0;
inline std::string build_key;
inline std::function<void(const Probe&)> preflight;

// The format is local to this executable/ABI. Strings, lengths and payloads
// are checked before allocation; metadata is explicit, never a raw C++ struct.
struct Archive {
    bool reading = false;
    size_t position = 0;
    std::vector<uint8_t> bytes;
    template<class... T> void operator()(T&... values) { (field(values), ...); }
    template<class T> void field(T& value) {
        static_assert(std::is_arithmetic_v<T> || std::is_enum_v<T>);
        if (reading) {
            if (sizeof(T) > bytes.size() - position) throw std::runtime_error("truncated cache metadata");
            std::memcpy(&value, bytes.data() + position, sizeof(T)); position += sizeof(T);
        } else {
            const auto* begin = reinterpret_cast<const uint8_t*>(&value);
            bytes.insert(bytes.end(), begin, begin + sizeof(T));
        }
    }
    void field(bool& value) { uint8_t code = value ? 1 : 0; field(code); if (code > 1) throw std::runtime_error("invalid flag"); value = code != 0; }
    void field(std::string& value) {
        uint64_t count = value.size(); field(count);
        if (count > 1024 * 1024 || (reading && count > bytes.size() - position)) throw std::runtime_error("oversize cache string");
        if (reading) { value.assign(reinterpret_cast<const char*>(bytes.data() + position), size_t(count)); position += size_t(count); }
        else bytes.insert(bytes.end(), value.begin(), value.end());
    }
    template<class T, size_t N> void field(std::array<T, N>& value) { for (auto& item : value) field(item); }
    template<class T> void field(std::vector<T>& value) {
        uint64_t count = value.size(); field(count);
        if (count > 1024 * 1024 || (reading && count > (bytes.size() - position) / sizeof(T))) throw std::runtime_error("oversize cache vector");
        if (reading) value.resize(size_t(count));
        for (auto& item : value) field(item);
    }
    template<class T> void field(std::optional<T>& value) {
        bool present = value.has_value(); field(present);
        if (reading) { if (present) value.emplace(); else value.reset(); }
        if (present) field(*value);
    }
    void field(ExifValues& value) {
        uint32_t count = uint32_t(value.size()); field(count);
        if (count > 512) throw std::runtime_error("oversize EXIF cache");
        if (reading) {
            value.clear();
            for (uint32_t i = 0; i < count; ++i) { uint16_t tag; ExifValue item; (*this)(tag, item.type, item.count, item.bytes); value.emplace(tag, std::move(item)); }
        } else for (auto& [tag, item] : value) { auto key = tag; (*this)(key, item.type, item.count, item.bytes); }
    }
    void field(LensCorrectionInfo& v) { (*this)(v.available,v.applied,v.profile,v.reason,v.distortion,v.tca,v.vignetting,v.scale,v.focus_distance_m,v.focus_distance_assumed); }
    void field(Metadata& v) {
        (*this)(v.make,v.model,v.lens,v.datetime_original,v.iso,v.shutter_s,v.aperture,v.focal_mm,v.exposure_program,
            v.exposure_bias_ev,v.focal_35mm,v.extra_exif,v.lens_correction,v.orientation,v.as_shot_temperature_k,v.as_shot_tint);
    }
    void field(Probe& v) { (*this)(v.kind,v.width,v.height,v.metadata); }
    void field(spk::io::RawSourceSizes& v) { (*this)(v.raw_width,v.raw_height,v.width,v.height,v.iwidth,v.iheight,v.top_margin,v.left_margin,v.pixel_aspect); }
    void field(spk::io::RawMetadata& v) {
        (*this)(v.libraw_version,v.libraw_capabilities,v.make,v.model,v.decoder_name,v.sizes_before_postprocess,v.raw_flip,
            v.camera_whitebalance,v.post_scale_pre_mul,v.as_shot_wb_applied,v.black,v.black_level_per_channel,
            v.black_pattern_rows,v.black_pattern_cols,v.black_pattern,v.white_level,v.camera_white_level_per_channel,
            v.postprocess_black,v.postprocess_maximum,v.process_warnings,v.rgb_cam,v.colour_channels,v.camera_from_xyz,
            v.headroom_enabled,v.white_balance_exposure_restore,v.camera_to_output);
    }
};

inline std::optional<uint32_t> file_crc(const fs::path& path) {
    std::ifstream file(path, std::ios::binary);
    if (!file) return std::nullopt;
    std::array<char, 256 * 1024> buffer{}; uLong sum = crc32(0, nullptr, 0);
    while (file) { file.read(buffer.data(), buffer.size()); sum = crc32(sum, reinterpret_cast<const Bytef*>(buffer.data()), uInt(file.gcount())); }
    if (!file.eof()) return std::nullopt;
    return uint32_t(sum);
}
inline std::string key(const fs::path& source, const DecodeOptions& options) {
    if (directory.empty() || !capacity) return {};
    std::error_code error;
    const auto path = fs::weakly_canonical(source, error); if (error) return {};
    const auto size = fs::file_size(path, error); if (error) return {};
    const auto stamp = fs::last_write_time(path, error); if (error) return {};
    const auto sum = file_crc(path); if (!sum) return {};
    auto mode = options.raw_mode; auto temperature = options.temperature_k, tint = options.tint; auto lens = options.lens_correction;
    auto tag = build_key + ":raw-cache-2:" + path_utf8(path) + ":" + std::to_string(size) + ":" + std::to_string(stamp.time_since_epoch().count()) + ":" + std::to_string(*sum);
    Archive a; a(tag, mode, temperature, tint, lens);
    uint64_t hash = 14695981039346656037ull;
    for (uint8_t byte : a.bytes) { hash ^= byte; hash *= 1099511628211ull; }
    std::ostringstream text; text << std::hex << std::setw(16) << std::setfill('0') << hash; return text.str();
}
inline std::vector<fs::directory_entry> entries() {
    std::vector<fs::directory_entry> out; std::error_code error;
    for (fs::directory_iterator it(directory, error), end; !error && it != end; it.increment(error))
        if (it->path().extension() == ".spkdc" && it->symlink_status(error).type() == fs::file_type::regular) out.push_back(*it);
    return out;
}
inline void trim() {
    auto files = entries(); uint64_t total = 0; std::error_code error;
    for (const auto& file : files) { const auto size=file.file_size(error); if(!error)total+=size; }
    std::sort(files.begin(), files.end(), [](const auto& a, const auto& b) { std::error_code ea, eb; return a.last_write_time(ea) < b.last_write_time(eb); });
    for (const auto& file : files) {
        if (total <= capacity) break;
        const auto size = file.file_size(error);
        if (!error && fs::remove(file.path(), error)) total -= size;
    }
}
inline bool load(const std::string& id, FloatImage& image, Probe& probe) {
    if (id.empty()) return false;
    const auto path = directory / (id + ".spkdc"); std::error_code error;
    if (fs::symlink_status(path, error).type() != fs::file_type::regular) { ++misses; return false; }
    bool valid = false;
    try {
        std::unique_ptr<std::FILE, decltype(&std::fclose)> file(open_file(path, "rb"), std::fclose);
        auto read = [&](void* data, size_t size) { if (!file || std::fread(data, 1, size, file.get()) != size) throw std::runtime_error("short cache read"); };
        std::array<char, 8> magic; uint64_t metadata_bytes, pixel_bytes; uint32_t checksum;
        read(magic.data(), magic.size()); read(&metadata_bytes, 8); read(&pixel_bytes, 8); read(&checksum, 4);
        if (magic != std::array<char,8>{'S','P','K','D','C','0','2','\0'} || metadata_bytes > 8*1024*1024 ||
            metadata_bytes + pixel_bytes + 28 != fs::file_size(path) || pixel_bytes > capacity) throw std::runtime_error("invalid cache header");
        Archive a; a.reading = true; a.bytes.resize(size_t(metadata_bytes)); read(a.bytes.data(), a.bytes.size());
        FloatImage loaded; Probe saved; std::string saved_key;
        a(saved_key,loaded.width,loaded.height,saved,loaded.raw_metadata);
        if (a.position != a.bytes.size() || !loaded.width || !loaded.height || uint64_t(loaded.width)*loaded.height > 200000000 ||
            saved_key != id || saved.kind != FileKind::Raw || saved.width != probe.width || saved.height != probe.height ||
            uint64_t(loaded.width)*loaded.height > uint64_t(probe.width)*probe.height*2 ||
            pixel_bytes != uint64_t(loaded.width)*loaded.height*3*sizeof(float) || !loaded.raw_metadata)
            throw std::runtime_error("invalid cache dimensions");
        loaded.rgb.resize(size_t(pixel_bytes / sizeof(float))); read(loaded.rgb.data(), size_t(pixel_bytes));
        uLong actual = crc32_z(0, a.bytes.data(), a.bytes.size());
        actual = crc32_z(actual, reinterpret_cast<const Bytef*>(loaded.rgb.data()), size_t(pixel_bytes));
        if (uint32_t(actual) != checksum) throw std::runtime_error("cache checksum mismatch");
        loaded.decode_cache_hit = true; image = std::move(loaded); probe = std::move(saved); valid = true;
    } catch (...) { /* Cache errors cost a decode, never a photograph or a failed open. */ }
    if (valid) { ++hits; fs::last_write_time(path, fs::file_time_type::clock::now(), error); }
    else { ++misses; fs::remove(path, error); }
    return valid;
}
inline void save(const std::string& id, const FloatImage& image, const Probe& probe) {
    if (id.empty()) return;
    try {
        auto width=image.width,height=image.height; auto metadata=probe; auto raw=image.raw_metadata;
        auto saved_key=id;Archive a; a(saved_key,width,height,metadata,raw);
        const uint64_t metadata_bytes=a.bytes.size(), pixel_bytes=image.rgb.size()*sizeof(float);
        if (metadata_bytes+pixel_bytes+28 > capacity) return;
        std::error_code error; fs::create_directories(directory,error); if(error)return;
        uLong sum=crc32_z(0,a.bytes.data(),a.bytes.size()); sum=crc32_z(sum,reinterpret_cast<const Bytef*>(image.rgb.data()),size_t(pixel_bytes));
        const uint32_t checksum=uint32_t(sum); std::string why;
        write_file_atomic(directory/(id+".spkdc"),[&](std::FILE* file,std::string&){
            auto write=[&](const void* bytes,size_t count){return std::fwrite(bytes,1,count,file)==count;};
            return write("SPKDC02",8)&&write(&metadata_bytes,8)&&write(&pixel_bytes,8)&&write(&checksum,4)&&
                write(a.bytes.data(),a.bytes.size())&&write(image.rgb.data(),size_t(pixel_bytes));
        },true,why);
        trim();
    } catch (...) { /* Disk full, permission loss and malformed metadata disable only this cache write. */ }
}
} // namespace spkhost::decode_cache
