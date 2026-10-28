#pragma once
#ifdef _WIN32
#include <ctime>
#include <process.h>
inline std::tm* gmtime_r(const time_t* t, std::tm* out) { return gmtime_s(out,t)==0?out:nullptr; }
inline std::tm* localtime_r(const time_t* t, std::tm* out) { return localtime_s(out,t)==0?out:nullptr; }
inline time_t timegm(std::tm* t) { return _mkgmtime(t); }
inline int getpid() { return _getpid(); }
#endif
