# Generates a throwaway Xcode project holding one UI test (AllowTap.swift).
# Kept out of ios/App on purpose: the app project needs no test target for
# this, and nobody here can open Xcode to maintain one.
#
# Usage: ruby make-allow-tap-project.rb <out-dir> <path/to/AllowTap.swift>
# Needs the `xcodeproj` gem, which ships with CocoaPods.
require 'xcodeproj'

out_dir, swift_file = ARGV
abort 'usage: make-allow-tap-project.rb <out-dir> <swift-file>' unless out_dir && swift_file

project = Xcodeproj::Project.new(File.join(out_dir, 'AllowTap.xcodeproj'))
target = project.new_target(:ui_test_bundle, 'AllowTap', :ios, '16.0')
target.add_file_references([project.new_group('AllowTap').new_file(File.expand_path(swift_file))])
target.build_configurations.each do |config|
  config.build_settings.merge!(
    'PRODUCT_BUNDLE_IDENTIFIER' => 'com.super-productivity.simharness.allowtap',
    'GENERATE_INFOPLIST_FILE' => 'YES',
    'SWIFT_VERSION' => '5.0',
    'TARGETED_DEVICE_FAMILY' => '1,2'
  )
end
project.save

scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(target)
scheme.add_test_target(target)
scheme.save_as(project.path, 'AllowTap', true)
