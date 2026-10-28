cmake_minimum_required(VERSION 3.20)
project(SpektraLab LANGUAGES C CXX)

if(MSVC)
    # Sources and path literals are UTF-8, independently of the Windows locale.
    add_compile_options(/utf-8)
endif()

include(CTest)
add_subdirectory(engine)
