import assert from "node:assert/strict";
import test from "node:test";
import { isAllowedAddress, isPublicAddress } from "@/utils/network.js";

test("isPublicAddress rejects private, loopback, and link-local networks", () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "::1", "fc00::1"]) {
    assert.equal(isPublicAddress(address), false, address);
  }
});

test("isPublicAddress accepts public IPv4 and IPv6 addresses", () => {
  assert.equal(isPublicAddress("1.1.1.1"), true);
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
});

test("isAllowedAddress permits only intentional private endpoint ranges", () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "100.64.0.1", "fc00::1"]) {
    assert.equal(isAllowedAddress(address, true), true, address);
    assert.equal(isAllowedAddress(address, false), false, address);
  }
  for (const address of ["0.0.0.0", "169.254.169.254", "192.0.2.1", "224.0.0.1", "::"]) {
    assert.equal(isAllowedAddress(address, true), false, address);
  }
});
