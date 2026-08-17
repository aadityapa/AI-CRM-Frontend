"""Karnex - the reviewer reads the timesheet, then decides.

Two changes to frontend/admin-dashboard/src/crm/pages/Timesheets.tsx:

  1. Timesheets -> Approvals: the row now OPENS the timesheet. Approve and
     Reject are gone from the row entirely, because a decision taken off a
     summary line is a decision taken without reading anything.

  2. Timesheet detail: Approve and Reject move out of the header toolbar down
     to a new "Approval Decision" panel that sits AFTER the daily grid and
     BEFORE Invoice Details. The approver has to scroll past every day of the
     period to reach them.

It also lands the HR change you asked for earlier: HR can open and read every
timesheet but no longer sees Approve or Reject. RMG, Sales and Admin/CEO do.

    cd F:\\AI-Interview-Model-F-V2
    python karnex_approval_flow.py --check     see what it would do
    python karnex_approval_flow.py             apply

Idempotent - safe to run twice. If any anchor does not match it writes nothing
and tells you, rather than half-applying.
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import os

CHECK_ONLY = False
BAD = "  [FAIL]"

TARGET = "frontend/admin-dashboard/src/crm/pages/Timesheets.tsx"
TESTFILE = "frontend/admin-dashboard/src/crm/pages/TimesheetApprovals.test.tsx"

PATCHES = (
    "WwogewogICJuYW1lIjogImRldGFpbDogYXBwcm92YWwgZ2F0ZSBpcyBSTUcvU2FsZXMsIG5vdCBI"
    "UiIsCiAgIm9sZCI6ICIgIGNvbnN0IHsgaWQgfSA9IHVzZUNybVBhcmFtcygpO1xuICBjb25zdCBp"
    "c1N0YWZmID0gdXNlSGFzUm9sZShcIkhSXCIsIFwiRmluYW5jZVwiLCBcIlJNR1wiKTtcbiIsCiAg"
    "Im5ldyI6ICIgIGNvbnN0IHsgaWQgfSA9IHVzZUNybVBhcmFtcygpO1xuICAvKiBIUiByZXZpZXdz"
    "IHRpbWVzaGVldHMgYnV0IGRvZXMgbm90IGRlY2lkZSB0aGVtIOKAlCBhcHByb3ZhbCBzaXRzIHdp"
    "dGggUk1HLFxuICAgICBTYWxlcyBhbmQgKHZpYSBpc1N1cGVyQWRtaW4pIEFkbWluL0NFTy4gQW55"
    "b25lIHdobyBjYW4gcmVhY2ggdGhpcyBwYWdlIGNhblxuICAgICBzdGlsbCByZWFkIGV2ZXJ5IGVu"
    "dHJ5OyBvbmx5IHRoZSBkZWNpc2lvbiBpcyBnYXRlZC4gKi9cbiAgY29uc3QgY2FuQXBwcm92ZSA9"
    "IHVzZUhhc1JvbGUoXCJSTUdcIiwgXCJTYWxlc1wiKTtcbiIsCiAgIm1hcmtlciI6ICJjb25zdCBj"
    "YW5BcHByb3ZlID0gdXNlSGFzUm9sZShcIlJNR1wiLCBcIlNhbGVzXCIpOyIKIH0sCiB7CiAgIm5h"
    "bWUiOiAiZGV0YWlsOiBoZWFkZXIgdG9vbGJhciBsb3NlcyB0aGUgYnV0dG9ucywgZ2FpbnMgYSBw"
    "b2ludGVyIiwKICAib2xkIjogIiAgICAgICAgICB7dHMuc3RhdHVzID09PSBcIlN1Ym1pdHRlZFwi"
    "ICYmIGlzU3RhZmYgJiYgKFxuICAgICAgICAgICAgPD5cbiAgICAgICAgICAgICAgPGJ1dHRvbiBj"
    "bGFzc05hbWU9e2J0blByaW1hcnl9IG9uQ2xpY2s9eygpID0+IHNldENvbmZpcm0oXCJhcHByb3Zl"
    "XCIpfT5cbiAgICAgICAgICAgICAgICA8Q2hlY2sgc2l6ZT17MTV9IC8+IEFwcHJvdmVcbiAgICAg"
    "ICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICAgIDxidXR0b24gY2xhc3NOYW1lPXtidG5E"
    "YW5nZXJ9IG9uQ2xpY2s9eygpID0+IHNldFNob3dSZWplY3QodHJ1ZSl9PlxuICAgICAgICAgICAg"
    "ICAgIDxYIHNpemU9ezE1fSAvPiBSZWplY3RcbiAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAg"
    "ICAgICAgICA8Lz5cbiAgICAgICAgICApfVxuICAgICAgICA8L2Rpdj5cbiIsCiAgIm5ldyI6ICIg"
    "ICAgICAgICAge3RzLnN0YXR1cyA9PT0gXCJTdWJtaXR0ZWRcIiAmJiBjYW5BcHByb3ZlICYmIChc"
    "biAgICAgICAgICAgIC8qIFRoZSBkZWNpc2lvbiBpdHNlbGYgbGl2ZXMgYXQgdGhlIEZPT1Qgb2Yg"
    "dGhlIHBhZ2UsIGFmdGVyIGV2ZXJ5XG4gICAgICAgICAgICAgICBkYXkgb2YgdGhlIHBlcmlvZC4g"
    "VGhpcyBpcyBvbmx5IGEgcG9pbnRlciB0byBpdC4gKi9cbiAgICAgICAgICAgIDxhXG4gICAgICAg"
    "ICAgICAgIGhyZWY9XCIjYXBwcm92YWwtZGVjaXNpb25cIlxuICAgICAgICAgICAgICBjbGFzc05h"
    "bWU9XCJ0ZXh0LXhzIGZvbnQtc2VtaWJvbGQgdGV4dC1za3ktNjAwIGhvdmVyOnVuZGVybGluZSBk"
    "YXJrOnRleHQtc2t5LTQwMFwiXG4gICAgICAgICAgICA+XG4gICAgICAgICAgICAgIEF3YWl0aW5n"
    "IHlvdXIgYXBwcm92YWwg4oCUIHJldmlldyB0aGUgZW50cmllcyBiZWxvdyDihpNcbiAgICAgICAg"
    "ICAgIDwvYT5cbiAgICAgICAgICApfVxuICAgICAgICA8L2Rpdj5cbiIsCiAgIm1hcmtlciI6ICJo"
    "cmVmPVwiI2FwcHJvdmFsLWRlY2lzaW9uXCIiCiB9LAogewogICJuYW1lIjogImRldGFpbDogQXBw"
    "cm92YWwgRGVjaXNpb24gcGFuZWwgYmVsb3cgdGhlIGdyaWQsIGFib3ZlIEludm9pY2UgRGV0YWls"
    "cyIsCiAgIm9sZCI6ICIgICAgICB7LyogLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0t"
    "LS0tLS0tLS0tLS0tLS0tIGludm9pY2UgZGV0YWlscyAoY29sbGFwc2libGUpICovfVxuICAgICAg"
    "PEludm9pY2VEZXRhaWxzU2VjdGlvbiB0aW1lc2hlZXRJZD17dHMuaWR9IHNob3dUb2FzdD17c2hv"
    "d1RvYXN0fSAvPlxuIiwKICAibmV3IjogIiAgICAgIHsvKiAtLS0tLS0tLS0tLS0tLS0tLS0tLS0t"
    "LS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gYXBwcm92YWwgZGVjaXNpb25cblxuICAgICAgICAg"
    "IERlbGliZXJhdGVseSBCRUxPVyB0aGUgZGFpbHkgZ3JpZCBhbmQgQUJPVkUgaW52b2ljZSBkZXRh"
    "aWxzLCBub3QgaW5cbiAgICAgICAgICB0aGUgaGVhZGVyIHRvb2xiYXIuIEFuIGFwcHJvdmVyIHJl"
    "YWNoZXMgdGhlc2UgYnV0dG9ucyBvbmx5IGJ5XG4gICAgICAgICAgc2Nyb2xsaW5nIHBhc3QgZXZl"
    "cnkgZGF5IG9mIHRoZSBwZXJpb2QsIHNvIHRoZSBkZWNpc2lvbiBmb2xsb3dzIHRoZVxuICAgICAg"
    "ICAgIHJldmlldyBpbnN0ZWFkIG9mIHByZWNlZGluZyBpdC4gSW52b2ljaW5nIGlzIGEgY29uc2Vx"
    "dWVuY2Ugb2ZcbiAgICAgICAgICBhcHByb3ZhbCwgc28gaXQgcmVhZHMgYWZ0ZXIgaXQuICovfVxu"
    "ICAgICAge3RzLnN0YXR1cyA9PT0gXCJTdWJtaXR0ZWRcIiAmJiBjYW5BcHByb3ZlICYmIChcbiAg"
    "ICAgICAgPGRpdiBpZD1cImFwcHJvdmFsLWRlY2lzaW9uXCIgY2xhc3NOYW1lPVwiZWxldi0xIHJv"
    "dW5kZWQtcGFuZWwgcC00IHNtOnAtNVwiPlxuICAgICAgICAgIDxoMiBjbGFzc05hbWU9XCJ0ZXh0"
    "LXNtIGZvbnQtYm9sZCB0cmFja2luZy13aWRlIHRleHQtcHJpbWFyeVwiPkFwcHJvdmFsIERlY2lz"
    "aW9uPC9oMj5cbiAgICAgICAgICA8cCBjbGFzc05hbWU9XCJtdC0xIHRleHQteHMgdGV4dC1tdXRl"
    "ZFwiPlxuICAgICAgICAgICAgWW91IGhhdmUgbm93IHNlZW4gZXZlcnkgZW50cnkgaW4gdGhpcyB0"
    "aW1lc2hlZXQuIEFwcHJvdmUgaXQgdG8gcmVsZWFzZSB0aGUgcGVyaW9kXG4gICAgICAgICAgICBm"
    "b3IgaW52b2ljaW5nLCBvciByZWplY3QgaXQgYmFjayB0byB7ZW1wbG95ZWVOYW1lIHx8IFwidGhl"
    "IGVtcGxveWVlXCJ9IHdpdGggYSByZWFzb24uXG4gICAgICAgICAgPC9wPlxuICAgICAgICAgIDxk"
    "aXYgY2xhc3NOYW1lPVwibXQtNCBmbGV4IGZsZXgtd3JhcCBpdGVtcy1jZW50ZXIgZ2FwLTIgYm9y"
    "ZGVyLXQgYm9yZGVyLXN1YnRsZSBwdC00XCI+XG4gICAgICAgICAgICA8YnV0dG9uIGNsYXNzTmFt"
    "ZT17YnRuUHJpbWFyeX0gb25DbGljaz17KCkgPT4gc2V0Q29uZmlybShcImFwcHJvdmVcIil9Plxu"
    "ICAgICAgICAgICAgICA8Q2hlY2sgc2l6ZT17MTV9IC8+IEFwcHJvdmVcbiAgICAgICAgICAgIDwv"
    "YnV0dG9uPlxuICAgICAgICAgICAgPGJ1dHRvbiBjbGFzc05hbWU9e2J0bkRhbmdlcn0gb25DbGlj"
    "az17KCkgPT4gc2V0U2hvd1JlamVjdCh0cnVlKX0+XG4gICAgICAgICAgICAgIDxYIHNpemU9ezE1"
    "fSAvPiBSZWplY3RcbiAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgIDwvZGl2PlxuICAg"
    "ICAgICA8L2Rpdj5cbiAgICAgICl9XG5cbiAgICAgIHsvKiAtLS0tLS0tLS0tLS0tLS0tLS0tLS0t"
    "LS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gaW52b2ljZSBkZXRhaWxzIChjb2xsYXBzaWJsZSkg"
    "Ki99XG4gICAgICA8SW52b2ljZURldGFpbHNTZWN0aW9uIHRpbWVzaGVldElkPXt0cy5pZH0gc2hv"
    "d1RvYXN0PXtzaG93VG9hc3R9IC8+XG4iLAogICJtYXJrZXIiOiAiaWQ9XCJhcHByb3ZhbC1kZWNp"
    "c2lvblwiIgogfSwKIHsKICAibmFtZSI6ICJhcHByb3ZhbHMgbGlzdDogZGVjaWRlIHZzLiBsb29r"
    "IiwKICAib2xkIjogIiAgY29uc3QgY2FuQWN0ID0gdXNlSGFzUm9sZShcIkhSXCIsIFwiRmluYW5j"
    "ZVwiLCBcIlJNR1wiKTtcbiAgY29uc3QgY2FuSW52b2ljZSA9IHVzZUhhc1JvbGUoXCJGaW5hbmNl"
    "XCIsIFwiUk1HXCIpO1xuIiwKICAibmV3IjogIiAgLyogV2hvIG1heSBkZWNpZGUsIG5vdCB3aG8g"
    "bWF5IGxvb2suIEhSIGtlZXBzIGZ1bGwgdmlzaWJpbGl0eSBvZiB0aGlzIHRhYiDigJRcbiAgICAg"
    "dGhleSBqdXN0IGdldCBcIk9wZW5cIiBpbnN0ZWFkIG9mIFwiUmV2aWV3XCIsIGJlY2F1c2UgdGhl"
    "IGRlY2lzaW9uIGlzIFJNRydzLFxuICAgICBTYWxlcydzIG9yICh2aWEgaXNTdXBlckFkbWluKSBB"
    "ZG1pbi9DRU8ncy4gKi9cbiAgY29uc3QgY2FuQWN0ID0gdXNlSGFzUm9sZShcIlJNR1wiLCBcIlNh"
    "bGVzXCIpO1xuICBjb25zdCBjYW5JbnZvaWNlID0gdXNlSGFzUm9sZShcIkZpbmFuY2VcIiwgXCJS"
    "TUdcIik7XG4iLAogICJtYXJrZXIiOiAiV2hvIG1heSBkZWNpZGUsIG5vdCB3aG8gbWF5IGxvb2si"
    "CiB9LAogewogICJuYW1lIjogImFwcHJvdmFscyBsaXN0OiBkcm9wIHRoZSBub3ctdW51c2VkIHJl"
    "amVjdCBzdGF0ZSIsCiAgIm9sZCI6ICIgIGNvbnN0IFtidXN5SWQsIHNldEJ1c3lJZF0gPSB1c2VT"
    "dGF0ZTxudW1iZXIgfCBudWxsPihudWxsKTtcbiAgY29uc3QgW3JlamVjdElkLCBzZXRSZWplY3RJ"
    "ZF0gPSB1c2VTdGF0ZTxudW1iZXIgfCBudWxsPihudWxsKTtcbiAgY29uc3QgW3NlYXJjaCwgc2V0"
    "U2VhcmNoXSA9IHVzZVN0YXRlKFwiXCIpO1xuICBjb25zdCBbbW9udGgsIHNldE1vbnRoXSA9IHVz"
    "ZVN0YXRlKFwiXCIpO1xuICBjb25zdCBbeWVhciwgc2V0WWVhcl0gPSB1c2VTdGF0ZShcIlwiKTtc"
    "biAgY29uc3QgW3N0YXR1cywgc2V0U3RhdHVzXSA9IHVzZVN0YXRlKFwiXCIpO1xuXG4gIGNvbnN0"
    "IGxvYWQgPSB1c2VDYWxsYmFjayhhc3luYyAoKSA9PiB7XG4gICAgc2V0TG9hZGluZyh0cnVlKTtc"
    "biAgICBzZXRFcnJvcihcIlwiKTtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzID0gYXdhaXQg"
    "Y3JtR2V0PFJlcG9ydFJvd1tdPihcIi9hcGkvdGltZXNoZWV0cy9yZXBvcnRzL2FwcHJvdmFsc1wi"
    "KTtcbiIsCiAgIm5ldyI6ICIgIGNvbnN0IFtidXN5SWQsIHNldEJ1c3lJZF0gPSB1c2VTdGF0ZTxu"
    "dW1iZXIgfCBudWxsPihudWxsKTtcbiAgY29uc3QgW3NlYXJjaCwgc2V0U2VhcmNoXSA9IHVzZVN0"
    "YXRlKFwiXCIpO1xuICBjb25zdCBbbW9udGgsIHNldE1vbnRoXSA9IHVzZVN0YXRlKFwiXCIpO1xu"
    "ICBjb25zdCBbeWVhciwgc2V0WWVhcl0gPSB1c2VTdGF0ZShcIlwiKTtcbiAgY29uc3QgW3N0YXR1"
    "cywgc2V0U3RhdHVzXSA9IHVzZVN0YXRlKFwiXCIpO1xuXG4gIGNvbnN0IGxvYWQgPSB1c2VDYWxs"
    "YmFjayhhc3luYyAoKSA9PiB7XG4gICAgc2V0TG9hZGluZyh0cnVlKTtcbiAgICBzZXRFcnJvcihc"
    "IlwiKTtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzID0gYXdhaXQgY3JtR2V0PFJlcG9ydFJv"
    "d1tdPihcIi9hcGkvdGltZXNoZWV0cy9yZXBvcnRzL2FwcHJvdmFsc1wiKTtcbiIsCiAgIm1hcmtl"
    "ciI6ICJOT19SRUpFQ1RfU1RBVEUiCiB9LAogewogICJuYW1lIjogImFwcHJvdmFscyBsaXN0OiB0"
    "aGUgb25seSByb3cgYWN0aW9uIGxlZnQgaXMgaW52b2ljaW5nIiwKICAib2xkIjogIiAgY29uc3Qg"
    "YWN0ID0gYXN5bmMgKGlkOiBudW1iZXIsIGFjdGlvbjogXCJhcHByb3ZlXCIgfCBcImdlbmVyYXRl"
    "LWludm9pY2VcIikgPT4ge1xuICAgIHNldEJ1c3lJZChpZCk7XG4iLAogICJuZXciOiAiICAvKiBB"
    "cHByb3ZlIC8gcmVqZWN0IGFyZSBubyBsb25nZXIgcmVhY2hhYmxlIGZyb20gdGhpcyBsaXN0IOKA"
    "lCB0aGUgb25seSBhY3Rpb25cbiAgICAgbGVmdCB0aGF0IGlzIHNhZmUgd2l0aG91dCByZWFkaW5n"
    "IHRoZSB0aW1lc2hlZXQgaXMgaW52b2ljaW5nIGFuIGFscmVhZHlcbiAgICAgYXBwcm92ZWQgb25l"
    "LiAqL1xuICBjb25zdCBhY3QgPSBhc3luYyAoaWQ6IG51bWJlciwgYWN0aW9uOiBcImdlbmVyYXRl"
    "LWludm9pY2VcIikgPT4ge1xuICAgIHNldEJ1c3lJZChpZCk7XG4iLAogICJtYXJrZXIiOiAiYWN0"
    "aW9uOiBcImdlbmVyYXRlLWludm9pY2VcIikgPT4geyIKIH0sCiB7CiAgIm5hbWUiOiAiYXBwcm92"
    "YWxzIGxpc3Q6IGNsaWNrYWJsZSByb3csIFJldmlldyBidXR0b24sIG5vIGlubGluZSBkZWNpc2lv"
    "biIsCiAgIm9sZCI6ICIgICAgICAgICAgICAgICAgICA8dHIga2V5PXtpZH0gY2xhc3NOYW1lPVwi"
    "Ym9yZGVyLWIgYm9yZGVyLXN1YnRsZVwiPlxuICAgICAgICAgICAgICAgICAgICA8dGQgY2xhc3NO"
    "YW1lPXtjZWxsfT5cbiAgICAgICAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT1cImZsZXgg"
    "ZmxleC13cmFwIGdhcC0xXCI+XG4gICAgICAgICAgICAgICAgICAgICAgICB7Y2FuQWN0ICYmIHN1"
    "Ym1pdHRlZCAmJiAoXG4gICAgICAgICAgICAgICAgICAgICAgICAgIDw+XG4gICAgICAgICAgICAg"
    "ICAgICAgICAgICAgICAgPGJ1dHRvbiB0eXBlPVwiYnV0dG9uXCIgY2xhc3NOYW1lPXtgJHtidG5Q"
    "cmltYXJ5fSAhcHgtMiAhcHktMSB0ZXh0LXhzYH0gZGlzYWJsZWQ9e2J1c3lJZCA9PT0gaWR9XG4g"
    "ICAgICAgICAgICAgICAgICAgICAgICAgICAgICBvbkNsaWNrPXsoKSA9PiBhY3QoaWQsIFwiYXBw"
    "cm92ZVwiKX0+QXBwcm92ZTwvYnV0dG9uPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxi"
    "dXR0b24gdHlwZT1cImJ1dHRvblwiIGNsYXNzTmFtZT17YCR7YnRuRGFuZ2VyfSAhcHgtMiAhcHkt"
    "MSB0ZXh0LXhzYH0gZGlzYWJsZWQ9e2J1c3lJZCA9PT0gaWR9XG4gICAgICAgICAgICAgICAgICAg"
    "ICAgICAgICAgICBvbkNsaWNrPXsoKSA9PiBzZXRSZWplY3RJZChpZCl9PlJlamVjdDwvYnV0dG9u"
    "PlxuICAgICAgICAgICAgICAgICAgICAgICAgICA8Lz5cbiAgICAgICAgICAgICAgICAgICAgICAg"
    "ICl9XG4gICAgICAgICAgICAgICAgICAgICAgICB7Y2FuSW52b2ljZSAmJiAoXG4iLAogICJuZXci"
    "OiAiICAgICAgICAgICAgICAgICAgPHRyXG4gICAgICAgICAgICAgICAgICAgIGtleT17aWR9XG4g"
    "ICAgICAgICAgICAgICAgICAgIGNsYXNzTmFtZT1cInJvdy1ob3ZlciBjdXJzb3ItcG9pbnRlciBi"
    "b3JkZXItYiBib3JkZXItc3VidGxlIHRyYW5zaXRpb24tY29sb3JzIGR1cmF0aW9uLW1pY3JvIGVh"
    "c2Utc21vb3RoIGFjdGl2ZTpiZy1zdXJmYWNlLTBcIlxuICAgICAgICAgICAgICAgICAgICBvbkNs"
    "aWNrPXsoKSA9PiBjcm1OYXZpZ2F0ZShgdGltZXNoZWV0cy8ke2lkfWApfVxuICAgICAgICAgICAg"
    "ICAgICAgICB0aXRsZT1cIk9wZW4gdGhlIGZ1bGwgdGltZXNoZWV0XCJcbiAgICAgICAgICAgICAg"
    "ICAgID5cbiAgICAgICAgICAgICAgICAgICAgey8qIHN0b3BQcm9wYWdhdGlvbjogYSBidXR0b24g"
    "aW4gaGVyZSBpcyBpdHMgb3duIGludGVudCDigJQgaXRcbiAgICAgICAgICAgICAgICAgICAgICAg"
    "IG11c3Qgbm90IGFsc28gb3BlbiB0aGUgcm93IGJlaGluZCBpdC4gU2FtZSBydWxlXG4gICAgICAg"
    "ICAgICAgICAgICAgICAgICBEYXRhVGFibGUgYXBwbGllcyB0byBpdHMgc2VsZWN0aW9uIGNoZWNr"
    "Ym94LiAqL31cbiAgICAgICAgICAgICAgICAgICAgPHRkIGNsYXNzTmFtZT17Y2VsbH0gb25DbGlj"
    "az17KGUpID0+IGUuc3RvcFByb3BhZ2F0aW9uKCl9PlxuICAgICAgICAgICAgICAgICAgICAgIDxk"
    "aXYgY2xhc3NOYW1lPVwiZmxleCBmbGV4LXdyYXAgZ2FwLTFcIj5cbiAgICAgICAgICAgICAgICAg"
    "ICAgICAgIHsvKiBBcHByb3ZlIC8gUmVqZWN0IGRlbGliZXJhdGVseSBkbyBOT1QgbGl2ZSBoZXJl"
    "LiBBXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVjaXNpb24gdGFrZW4gb2ZmIGEgc3Vt"
    "bWFyeSByb3cgaXMgYSBkZWNpc2lvbiB0YWtlblxuICAgICAgICAgICAgICAgICAgICAgICAgICAg"
    "IHdpdGhvdXQgcmVhZGluZyB0aGUgdGltZXNoZWV0LCBzbyB0aGUgb25seSByb3V0ZSB0b1xuICAg"
    "ICAgICAgICAgICAgICAgICAgICAgICAgIHRoZW0gaXMgb3BlbmluZyBpdCDigJQgdGhleSBzaXQg"
    "YXQgdGhlIGZvb3Qgb2YgdGhlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGV0YWlsIHBh"
    "Z2UsIHVuZGVyIHRoZSBkYWlseSBncmlkLiAqL31cbiAgICAgICAgICAgICAgICAgICAgICAgIDxi"
    "dXR0b25cbiAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZT1cImJ1dHRvblwiXG4gICAgICAg"
    "ICAgICAgICAgICAgICAgICAgIGNsYXNzTmFtZT17YCR7Y2FuQWN0ICYmIHN1Ym1pdHRlZCA/IGJ0"
    "blByaW1hcnkgOiBidG5TZWNvbmRhcnl9ICFweC0yICFweS0xIHRleHQteHNgfVxuICAgICAgICAg"
    "ICAgICAgICAgICAgICAgICBvbkNsaWNrPXsoKSA9PiBjcm1OYXZpZ2F0ZShgdGltZXNoZWV0cy8k"
    "e2lkfWApfVxuICAgICAgICAgICAgICAgICAgICAgICAgICB0aXRsZT17Y2FuQWN0ICYmIHN1Ym1p"
    "dHRlZFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgID8gXCJPcGVuIHRoZSB0aW1lc2hlZXQs"
    "IHJldmlldyB0aGUgZW50cmllcywgdGhlbiBhcHByb3ZlIG9yIHJlamVjdFwiXG4gICAgICAgICAg"
    "ICAgICAgICAgICAgICAgICAgOiBcIk9wZW4gdGhlIHRpbWVzaGVldFwifVxuICAgICAgICAgICAg"
    "ICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgICAgICAgICAgICB7Y2FuQWN0ICYmIHN1Ym1p"
    "dHRlZCA/IFwiUmV2aWV3XCIgOiBcIk9wZW5cIn1cbiAgICAgICAgICAgICAgICAgICAgICAgIDwv"
    "YnV0dG9uPlxuICAgICAgICAgICAgICAgICAgICAgICAge2Nhbkludm9pY2UgJiYgKFxuIiwKICAi"
    "bWFya2VyIjogInRpdGxlPVwiT3BlbiB0aGUgZnVsbCB0aW1lc2hlZXRcIiIKIH0sCiB7CiAgIm5h"
    "bWUiOiAiYXBwcm92YWxzIGxpc3Q6IGF0dGFjaG1lbnRzIGNlbGwgKyByZXRpcmUgdGhlIGxpc3Qg"
    "cmVqZWN0IG1vZGFsIiwKICAib2xkIjogIiAgICAgICAgICAgICAgICAgICAgPHRkIGNsYXNzTmFt"
    "ZT17Y2VsbH0+e251bShyLnRvdGFsX2xlYXZlX2RheXMpfTwvdGQ+XG4gICAgICAgICAgICAgICAg"
    "ICAgIDx0ZCBjbGFzc05hbWU9e2NlbGx9PlxuICAgICAgICAgICAgICAgICAgICAgIDxBdHRhY2ht"
    "ZW50TGlzdCB0aW1lc2hlZXRJZD17aWR9IGF0dGFjaG1lbnRzPXtyLmF0dGFjaG1lbnRzfSBvbkNo"
    "YW5nZT17bG9hZH0gc2hvd1RvYXN0PXtzaG93VG9hc3R9IC8+XG4gICAgICAgICAgICAgICAgICAg"
    "IDwvdGQ+XG4gICAgICAgICAgICAgICAgICA8L3RyPlxuICAgICAgICAgICAgICAgICk7XG4gICAg"
    "ICAgICAgICAgIH0pfVxuICAgICAgICAgICAgPC90Ym9keT5cbiAgICAgICAgICA8L3RhYmxlPlxu"
    "ICAgICAgICA8L2Rpdj5cbiAgICAgIDwvZGl2PlxuICAgICAge3JlamVjdElkICE9IG51bGwgJiYg"
    "KFxuICAgICAgICA8UmVqZWN0TW9kYWxcbiAgICAgICAgICB0aW1lc2hlZXRJZD17cmVqZWN0SWR9"
    "XG4gICAgICAgICAgb25DbG9zZT17KCkgPT4gc2V0UmVqZWN0SWQobnVsbCl9XG4gICAgICAgICAg"
    "b25Eb25lPXsoKSA9PiB7IHNldFJlamVjdElkKG51bGwpOyBzaG93VG9hc3QoXCJUaW1lc2hlZXQg"
    "cmVqZWN0ZWRcIik7IGxvYWQoKTsgfX1cbiAgICAgICAgICBvbkVycm9yPXsobSkgPT4gc2hvd1Rv"
    "YXN0KG0sIFwiZXJyXCIpfVxuICAgICAgICAvPlxuICAgICAgKX1cbiAgICA8Lz5cbiIsCiAgIm5l"
    "dyI6ICIgICAgICAgICAgICAgICAgICAgIDx0ZCBjbGFzc05hbWU9e2NlbGx9PntudW0oci50b3Rh"
    "bF9sZWF2ZV9kYXlzKX08L3RkPlxuICAgICAgICAgICAgICAgICAgICB7LyogVXBsb2FkaW5nIG9y"
    "IHJlbW92aW5nIGFuIGF0dGFjaG1lbnQgaXMgaXRzIG93biBpbnRlbnQgdG9vLiAqL31cbiAgICAg"
    "ICAgICAgICAgICAgICAgPHRkIGNsYXNzTmFtZT17Y2VsbH0gb25DbGljaz17KGUpID0+IGUuc3Rv"
    "cFByb3BhZ2F0aW9uKCl9PlxuICAgICAgICAgICAgICAgICAgICAgIDxBdHRhY2htZW50TGlzdCB0"
    "aW1lc2hlZXRJZD17aWR9IGF0dGFjaG1lbnRzPXtyLmF0dGFjaG1lbnRzfSBvbkNoYW5nZT17bG9h"
    "ZH0gc2hvd1RvYXN0PXtzaG93VG9hc3R9IC8+XG4gICAgICAgICAgICAgICAgICAgIDwvdGQ+XG4g"
    "ICAgICAgICAgICAgICAgICA8L3RyPlxuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAg"
    "IH0pfVxuICAgICAgICAgICAgPC90Ym9keT5cbiAgICAgICAgICA8L3RhYmxlPlxuICAgICAgICA8"
    "L2Rpdj5cbiAgICAgIDwvZGl2PlxuICAgIDwvPlxuIiwKICAibWFya2VyIjogIlVwbG9hZGluZyBv"
    "ciByZW1vdmluZyBhbiBhdHRhY2htZW50IGlzIGl0cyBvd24gaW50ZW50IHRvbyIKIH0KXQ=="
)

TEST_B64 = (
    "LyoqIEFwcHJvdmFsIG11c3QgZm9sbG93IHJldmlldywgbm90IHByZWNlZGUgaXQuCiAqCiAqIFRo"
    "ZSBydWxlIHRoZXNlIHRlc3RzIHByb3RlY3Q6IGEgcmV2aWV3ZXIgY2Fubm90IGFwcHJvdmUgb3Ig"
    "cmVqZWN0IGEgdGltZXNoZWV0CiAqIGZyb20gYSBzdW1tYXJ5IHJvdy4gVGhlIG9ubHkgcm91dGUg"
    "dG8gdGhvc2UgYnV0dG9ucyBpcyBvcGVuaW5nIHRoZSB0aW1lc2hlZXQKICogYW5kIHNjcm9sbGlu"
    "ZyBwYXN0IGV2ZXJ5IGRheSBvZiB0aGUgcGVyaW9kIOKAlCBzbyB0aGUgYnV0dG9ucyBsaXZlIGF0"
    "IHRoZSBmb290CiAqIG9mIHRoZSBkZXRhaWwgcGFnZSwgdW5kZXIgdGhlIGRhaWx5IGdyaWQgYW5k"
    "IGFib3ZlIEludm9pY2UgRGV0YWlscy4KICoKICogVHdvIHRoaW5ncyBjb3VsZCBxdWlldGx5IHVu"
    "ZG8gdGhhdDogc29tZW9uZSByZS1hZGRpbmcgQXBwcm92ZS9SZWplY3QgdG8gdGhlCiAqIGxpc3Qg"
    "Zm9yIGNvbnZlbmllbmNlLCBvciBzb21lb25lIG1vdmluZyB0aGVtIGJhY2sgdXAgdG8gdGhlIGRl"
    "dGFpbCBwYWdlJ3MKICogaGVhZGVyIHRvb2xiYXIgd2hlcmUgdGhleSBzaXQgYWJvdmUgdGhlIGVu"
    "dHJpZXMuIEJvdGggYXJlIGFzc2VydGVkIGFnYWluc3QuCiAqLwppbXBvcnQgeyBkZXNjcmliZSwg"
    "aXQsIGV4cGVjdCwgdmksIGJlZm9yZUVhY2ggfSBmcm9tICJ2aXRlc3QiOwppbXBvcnQgeyByZW5k"
    "ZXIsIHNjcmVlbiwgd2FpdEZvciwgd2l0aGluLCBmaXJlRXZlbnQgfSBmcm9tICJAdGVzdGluZy1s"
    "aWJyYXJ5L3JlYWN0IjsKaW1wb3J0IHsgQ3JtTWVQcm92aWRlciwgdHlwZSBNZSB9IGZyb20gIi4u"
    "L0NybUFwcCI7Cgpjb25zdCBuYXZpZ2F0ZSA9IHZpLmZuKCk7CnZpLm1vY2soIi4uL3JvdXRlckhv"
    "b2tzIiwgYXN5bmMgKCkgPT4gewogIGNvbnN0IGFjdHVhbCA9IGF3YWl0IHZpLmltcG9ydEFjdHVh"
    "bDxhbnk+KCIuLi9yb3V0ZXJIb29rcyIpOwogIHJldHVybiB7IC4uLmFjdHVhbCwgY3JtTmF2aWdh"
    "dGU6ICguLi5hOiBhbnlbXSkgPT4gbmF2aWdhdGUoLi4uYSksIHVzZUNybVBhcmFtczogKCkgPT4g"
    "KHsgaWQ6ICI3IiB9KSB9Owp9KTsKCmNvbnN0IEFQUFJPVkFMU19ST1cgPSB7CiAgaWQ6IDcsCiAg"
    "c3RhdHVzOiAiU3VibWl0dGVkIiwKICBzdGF0dXNfbGFiZWw6ICJTdWJtaXR0ZWQiLAogIHRpbWVz"
    "aGVldF9wZXJpb2Q6ICIwMSBBdWcgMjAyNiDigJMgMzEgQXVnIDIwMjYiLAogIHByb2plY3RfZW1w"
    "bG95ZWVfbmFtZTogIkFtdWx5YSBIIEsiLAogIHByb2plY3RfdHlwZTogImNvbnRyYWN0IiwKICB0"
    "b3RhbF9ob3Vyc193b3JrZWQ6IDE2OCwKICBhdHRhY2htZW50czogW10sCn07Cgpjb25zdCBjcm1H"
    "ZXQgPSB2aS5mbigpOwpjb25zdCBjcm1Qb3N0ID0gdmkuZm4oKTsKdmkubW9jaygiLi4vYXBpIiwg"
    "YXN5bmMgKCkgPT4gewogIGNvbnN0IGFjdHVhbCA9IGF3YWl0IHZpLmltcG9ydEFjdHVhbDxhbnk+"
    "KCIuLi9hcGkiKTsKICByZXR1cm4geyAuLi5hY3R1YWwsIGNybUdldDogKC4uLmE6IGFueVtdKSA9"
    "PiBjcm1HZXQoLi4uYSksIGNybVBvc3Q6ICguLi5hOiBhbnlbXSkgPT4gY3JtUG9zdCguLi5hKSwg"
    "Y3JtRGVsZXRlOiB2aS5mbigpIH07Cn0pOwoKaW1wb3J0IHsgVGltZXNoZWV0c0xpc3RQYWdlLCBU"
    "aW1lc2hlZXREZXRhaWxQYWdlIH0gZnJvbSAiLi9UaW1lc2hlZXRzIjsKCmZ1bmN0aW9uIG1lKHJv"
    "bGVzOiBzdHJpbmdbXSk6IE1lIHsKICByZXR1cm4geyBpZDogMSwgdXNlcm5hbWU6ICJ1IiwgZnVs"
    "bF9uYW1lOiAiVXNlciIsIGVtYWlsOiAidUBleGFtcGxlLmNvbSIsIHJvbGVzIH07Cn0KCi8qKiBP"
    "bmUgcm91dGUgdGFibGUgZm9yIGJvdGggcGFnZXMsIHNvIGEgdGVzdCBvbmx5IHNheXMgd2hpY2gg"
    "cm9sZXMgYXJlIGFjdGluZy4gKi8KZnVuY3Rpb24gcm91dGUocGF0aDogc3RyaW5nKSB7CiAgaWYg"
    "KHBhdGguaW5jbHVkZXMoIi9yZXBvcnRzL2FwcHJvdmFscyIpKSByZXR1cm4geyBkYXRhOiBbQVBQ"
    "Uk9WQUxTX1JPV10sIG1lc3NhZ2U6ICIiIH07CiAgaWYgKC9cL2FwaVwvdGltZXNoZWV0c1wvNyQv"
    "LnRlc3QocGF0aCkpIHsKICAgIHJldHVybiB7CiAgICAgIGRhdGE6IHsKICAgICAgICBpZDogNywg"
    "c3RhdHVzOiAiU3VibWl0dGVkIiwgZW1wbG95ZWVfaWQ6IDMsIHByb2plY3RfaWQ6IDEsCiAgICAg"
    "ICAgcGVyaW9kX3N0YXJ0X2RhdGU6ICIyMDI2LTA4LTAxIiwgcGVyaW9kX2VuZF9kYXRlOiAiMjAy"
    "Ni0wOC0zMSIsCiAgICAgICAgdGltZXNoZWV0X3BlcmlvZDogIjAxIEF1ZyAyMDI2IOKAkyAzMSBB"
    "dWcgMjAyNiIsCiAgICAgIH0sCiAgICAgIG1lc3NhZ2U6ICIiLAogICAgfTsKICB9CiAgaWYgKC9c"
    "L2FwaVwvdGltZXNoZWV0c1wvN1wvZW50cmllcy8udGVzdChwYXRoKSkgcmV0dXJuIHsgZGF0YTog"
    "W10sIG1lc3NhZ2U6ICIiIH07CiAgaWYgKC9cL2FwaVwvdGltZXNoZWV0c1wvN1wvc3VtbWFyeS8u"
    "dGVzdChwYXRoKSkgcmV0dXJuIHsgZGF0YToge30sIG1lc3NhZ2U6ICIiIH07CiAgcmV0dXJuIHsg"
    "ZGF0YTogW10sIG1lc3NhZ2U6ICIiIH07Cn0KCmJlZm9yZUVhY2goKCkgPT4gewogIG5hdmlnYXRl"
    "Lm1vY2tSZXNldCgpOwogIGNybVBvc3QubW9ja1Jlc2V0KCk7CiAgY3JtR2V0Lm1vY2tSZXNldCgp"
    "OwogIGNybUdldC5tb2NrSW1wbGVtZW50YXRpb24oYXN5bmMgKHBhdGg6IHN0cmluZykgPT4gcm91"
    "dGUocGF0aCkpOwp9KTsKCmFzeW5jIGZ1bmN0aW9uIHJlbmRlckFwcHJvdmFscyhyb2xlczogc3Ry"
    "aW5nW10pIHsKICByZW5kZXIoCiAgICA8Q3JtTWVQcm92aWRlciB2YWx1ZT17bWUocm9sZXMpfT4K"
    "ICAgICAgPFRpbWVzaGVldHNMaXN0UGFnZSAvPgogICAgPC9Dcm1NZVByb3ZpZGVyPiwKICApOwog"
    "IGZpcmVFdmVudC5jbGljayhhd2FpdCBzY3JlZW4uZmluZEJ5Um9sZSgiYnV0dG9uIiwgeyBuYW1l"
    "OiAvYXBwcm92YWxzL2kgfSkpOwogIHJldHVybiBhd2FpdCBzY3JlZW4uZmluZEJ5VGV4dCgiQW11"
    "bHlhIEggSyIpOwp9CgpkZXNjcmliZSgiVGltZXNoZWV0IGFwcHJvdmFscyBsaXN0IiwgKCkgPT4g"
    "ewogIGl0KCJvZmZlcnMgbm8gQXBwcm92ZSBvciBSZWplY3Qgb24gdGhlIHJvdyDigJQgdGhlIGRl"
    "Y2lzaW9uIG5lZWRzIHRoZSB0aW1lc2hlZXQgb3BlbiIsIGFzeW5jICgpID0+IHsKICAgIGF3YWl0"
    "IHJlbmRlckFwcHJvdmFscyhbIlJNRyJdKTsKICAgIGV4cGVjdChzY3JlZW4ucXVlcnlCeVJvbGUo"
    "ImJ1dHRvbiIsIHsgbmFtZTogL15hcHByb3ZlJC9pIH0pKS50b0JlTnVsbCgpOwogICAgZXhwZWN0"
    "KHNjcmVlbi5xdWVyeUJ5Um9sZSgiYnV0dG9uIiwgeyBuYW1lOiAvXnJlamVjdCQvaSB9KSkudG9C"
    "ZU51bGwoKTsKICB9KTsKCiAgaXQoIm9wZW5zIHRoZSBmdWxsIHRpbWVzaGVldCB3aGVuIHRoZSBy"
    "b3cgaXMgY2xpY2tlZCIsIGFzeW5jICgpID0+IHsKICAgIGNvbnN0IG5hbWVDZWxsID0gYXdhaXQg"
    "cmVuZGVyQXBwcm92YWxzKFsiUk1HIl0pOwogICAgZmlyZUV2ZW50LmNsaWNrKG5hbWVDZWxsKTsK"
    "ICAgIGV4cGVjdChuYXZpZ2F0ZSkudG9IYXZlQmVlbkNhbGxlZFdpdGgoInRpbWVzaGVldHMvNyIp"
    "OwogIH0pOwoKICBpdCgibGFiZWxzIHRoZSBhY3Rpb24gUmV2aWV3IGZvciBhbiBhcHByb3Zlciwg"
    "c28gdGhlIGludGVudCBpcyB0byByZWFkIGl0IGZpcnN0IiwgYXN5bmMgKCkgPT4gewogICAgYXdh"
    "aXQgcmVuZGVyQXBwcm92YWxzKFsiUk1HIl0pOwogICAgY29uc3QgcmV2aWV3ID0gc2NyZWVuLmdl"
    "dEJ5Um9sZSgiYnV0dG9uIiwgeyBuYW1lOiAvcmV2aWV3L2kgfSk7CiAgICBmaXJlRXZlbnQuY2xp"
    "Y2socmV2aWV3KTsKICAgIGV4cGVjdChuYXZpZ2F0ZSkudG9IYXZlQmVlbkNhbGxlZFdpdGgoInRp"
    "bWVzaGVldHMvNyIpOwogICAgLy8gT25lIG5hdmlnYXRpb24sIG5vdCB0d286IHRoZSBjZWxsIHN0"
    "b3BzIHRoZSBjbGljayByZWFjaGluZyB0aGUgcm93LgogICAgZXhwZWN0KG5hdmlnYXRlKS50b0hh"
    "dmVCZWVuQ2FsbGVkVGltZXMoMSk7CiAgfSk7CgogIGl0KCJzYXlzIE9wZW4sIG5vdCBSZXZpZXcs"
    "IGZvciBIUiDigJQgd2hvIHJlYWRzIHRpbWVzaGVldHMgYnV0IGRvZXMgbm90IGRlY2lkZSB0aGVt"
    "IiwgYXN5bmMgKCkgPT4gewogICAgYXdhaXQgcmVuZGVyQXBwcm92YWxzKFsiSFIiXSk7CiAgICBl"
    "eHBlY3Qoc2NyZWVuLmdldEJ5Um9sZSgiYnV0dG9uIiwgeyBuYW1lOiAvXm9wZW4kL2kgfSkpLnRv"
    "QmVUcnV0aHkoKTsKICAgIGV4cGVjdChzY3JlZW4ucXVlcnlCeVJvbGUoImJ1dHRvbiIsIHsgbmFt"
    "ZTogL3Jldmlldy9pIH0pKS50b0JlTnVsbCgpOwogIH0pOwp9KTsKCmRlc2NyaWJlKCJUaW1lc2hl"
    "ZXQgZGV0YWlsIOKAlCBhcHByb3ZhbCBkZWNpc2lvbiIsICgpID0+IHsKICBhc3luYyBmdW5jdGlv"
    "biByZW5kZXJEZXRhaWwocm9sZXM6IHN0cmluZ1tdKSB7CiAgICBjb25zdCB7IGNvbnRhaW5lciB9"
    "ID0gcmVuZGVyKAogICAgICA8Q3JtTWVQcm92aWRlciB2YWx1ZT17bWUocm9sZXMpfT4KICAgICAg"
    "ICA8VGltZXNoZWV0RGV0YWlsUGFnZSAvPgogICAgICA8L0NybU1lUHJvdmlkZXI+LAogICAgKTsK"
    "ICAgIGF3YWl0IHdhaXRGb3IoKCkgPT4gZXhwZWN0KGNybUdldCkudG9IYXZlQmVlbkNhbGxlZCgp"
    "KTsKICAgIHJldHVybiBjb250YWluZXI7CiAgfQoKICBpdCgicHV0cyBBcHByb3ZlL1JlamVjdCBh"
    "ZnRlciB0aGUgZGFpbHkgZ3JpZCBhbmQgYmVmb3JlIEludm9pY2UgRGV0YWlscyIsIGFzeW5jICgp"
    "ID0+IHsKICAgIGNvbnN0IGNvbnRhaW5lciA9IGF3YWl0IHJlbmRlckRldGFpbChbIlJNRyJdKTsK"
    "ICAgIGNvbnN0IHBhbmVsID0gYXdhaXQgd2FpdEZvcigoKSA9PiB7CiAgICAgIGNvbnN0IGVsID0g"
    "Y29udGFpbmVyLnF1ZXJ5U2VsZWN0b3IoIiNhcHByb3ZhbC1kZWNpc2lvbiIpOwogICAgICBpZiAo"
    "IWVsKSB0aHJvdyBuZXcgRXJyb3IoIm5vIGFwcHJvdmFsIHBhbmVsIik7CiAgICAgIHJldHVybiBl"
    "bCBhcyBIVE1MRWxlbWVudDsKICAgIH0pOwogICAgZXhwZWN0KHdpdGhpbihwYW5lbCkuZ2V0QnlS"
    "b2xlKCJidXR0b24iLCB7IG5hbWU6IC9hcHByb3ZlL2kgfSkpLnRvQmVUcnV0aHkoKTsKICAgIGV4"
    "cGVjdCh3aXRoaW4ocGFuZWwpLmdldEJ5Um9sZSgiYnV0dG9uIiwgeyBuYW1lOiAvcmVqZWN0L2kg"
    "fSkpLnRvQmVUcnV0aHkoKTsKCiAgICAvLyBPcmRlcmluZyBpcyB0aGUgd2hvbGUgcG9pbnQsIHNv"
    "IGFzc2VydCBpdCBzdHJ1Y3R1cmFsbHkgcmF0aGVyIHRoYW4gYnkgZXllLgogICAgY29uc3QgZ3Jp"
    "ZCA9IGNvbnRhaW5lci5xdWVyeVNlbGVjdG9yKCdbYXJpYS1sYWJlbD0iVGltZXNoZWV0IGRhaWx5"
    "IGVudHJpZXMiXScpITsKICAgIGNvbnN0IGludm9pY2UgPSBBcnJheS5mcm9tKGNvbnRhaW5lci5x"
    "dWVyeVNlbGVjdG9yQWxsKCIqIikpLmZpbmQoCiAgICAgIChuKSA9PiBuLnRleHRDb250ZW50Py50"
    "cmltKCkgPT09ICJJbnZvaWNlIERldGFpbHMiLAogICAgKTsKICAgIGV4cGVjdChncmlkLmNvbXBh"
    "cmVEb2N1bWVudFBvc2l0aW9uKHBhbmVsKSAmIE5vZGUuRE9DVU1FTlRfUE9TSVRJT05fRk9MTE9X"
    "SU5HKS50b0JlVHJ1dGh5KCk7CiAgICBpZiAoaW52b2ljZSkgewogICAgICBleHBlY3QocGFuZWwu"
    "Y29tcGFyZURvY3VtZW50UG9zaXRpb24oaW52b2ljZSkgJiBOb2RlLkRPQ1VNRU5UX1BPU0lUSU9O"
    "X0ZPTExPV0lORykudG9CZVRydXRoeSgpOwogICAgfQogIH0pOwoKICBpdCgic2hvd3MgSFIgdGhl"
    "IHRpbWVzaGVldCBidXQgbm8gZGVjaXNpb24gYnV0dG9ucyIsIGFzeW5jICgpID0+IHsKICAgIGNv"
    "bnN0IGNvbnRhaW5lciA9IGF3YWl0IHJlbmRlckRldGFpbChbIkhSIl0pOwogICAgYXdhaXQgd2Fp"
    "dEZvcigoKSA9PiBleHBlY3QoY29udGFpbmVyLnF1ZXJ5U2VsZWN0b3IoInRhYmxlIikpLnRvQmVU"
    "cnV0aHkoKSk7CiAgICBleHBlY3QoY29udGFpbmVyLnF1ZXJ5U2VsZWN0b3IoIiNhcHByb3ZhbC1k"
    "ZWNpc2lvbiIpKS50b0JlTnVsbCgpOwogICAgZXhwZWN0KHNjcmVlbi5xdWVyeUJ5Um9sZSgiYnV0"
    "dG9uIiwgeyBuYW1lOiAvXmFwcHJvdmUkL2kgfSkpLnRvQmVOdWxsKCk7CiAgfSk7CgogIGl0KCJn"
    "cmFudHMgQWRtaW4vQ0VPIHRoZSBkZWNpc2lvbiB0aHJvdWdoIGlzU3VwZXJBZG1pbiwgd2l0aCBu"
    "byBleHBsaWNpdCByb2xlIHJvdyIsIGFzeW5jICgpID0+IHsKICAgIGNvbnN0IGNvbnRhaW5lciA9"
    "IGF3YWl0IHJlbmRlckRldGFpbChbIkFkbWluIl0pOwogICAgYXdhaXQgd2FpdEZvcigoKSA9PiBl"
    "eHBlY3QoY29udGFpbmVyLnF1ZXJ5U2VsZWN0b3IoIiNhcHByb3ZhbC1kZWNpc2lvbiIpKS50b0Jl"
    "VHJ1dGh5KCkpOwogIH0pOwp9KTsK"
)


def repo_root() -> str:
    """Accept the repo root, the frontend folder, or the admin-dashboard folder."""
    here = os.path.abspath(os.getcwd())
    for cand in (here, os.path.dirname(here), os.path.dirname(os.path.dirname(here))):
        if os.path.isfile(os.path.join(cand, TARGET.replace("/", os.sep))):
            return cand
    print("ERROR: run this from F:\\AI-Interview-Model-F-V2")
    print("       (could not find " + TARGET + " from " + here + ")")
    raise SystemExit(2)


def read_text(path: str) -> str:
    with io.open(path, "r", encoding="utf-8", newline="") as fh:
        return fh.read()


def dominant_newline(text: str) -> str:
    """Their working copy has been flipping between CRLF and LF. Patch against
    LF always, then write back whatever the file already used, so this change
    does not turn into another 3,000-line whitespace diff."""
    crlf = text.count("\r\n")
    lf = text.count("\n") - crlf
    return "\r\n" if crlf > lf else "\n"


def write_text(path: str, text: str, newline: str) -> None:
    if CHECK_ONLY:
        return
    with io.open(path, "w", encoding="utf-8", newline="") as fh:
        fh.write(text.replace("\n", newline))


def patch_timesheets(root: str) -> bool:
    print("=== 1. " + TARGET + " ===")
    path = os.path.join(root, TARGET.replace("/", os.sep))
    raw = read_text(path)
    newline = dominant_newline(raw)
    text = raw.replace("\r\n", "\n")
    print("  line endings: " + ("CRLF" if newline == "\r\n" else "LF") + " (preserved)")

    patches = json.loads(base64.b64decode(PATCHES).decode("utf-8"))
    applied = skipped = 0
    for p in patches:
        if p["marker"] in text or (p["marker"] == "NO_REJECT_STATE"
                                   and "const [rejectId, setRejectId]" not in text):
            print("  already done  " + p["name"])
            skipped += 1
            continue
        found = text.count(p["old"])
        if found != 1:
            print(BAD + " " + p["name"])
            print("         anchor matched " + str(found) + " times, expected 1.")
            print("         Nothing has been written. Paste this whole output back to Claude.")
            return False
        text = text.replace(p["old"], p["new"])
        print("  " + ("would patch" if CHECK_ONLY else "patched") + "   " + p["name"])
        applied += 1

    if applied:
        write_text(path, text, newline)
    print("  -> " + str(applied) + " applied, " + str(skipped) + " already in place")
    return True


def write_test(root: str) -> None:
    print("")
    print("=== 2. Regression test ===")
    dest = os.path.join(root, TESTFILE.replace("/", os.sep))
    data = base64.b64decode(TEST_B64)
    old = io.open(dest, "rb").read() if os.path.exists(dest) else None
    if old == data:
        print("  unchanged  " + TESTFILE)
        return
    if not CHECK_ONLY:
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        io.open(dest, "wb").write(data)
    verb = "would write" if CHECK_ONLY else ("updated" if old else "created")
    print("  " + verb + "  " + TESTFILE)
    print("  Locks the rule in: no Approve/Reject on a summary row, and on the")
    print("  detail page they must sit AFTER the daily grid and BEFORE invoicing.")


def summary() -> None:
    print("")
    print("=== 3. What changes for a reviewer ===")
    print("")
    print("  Timesheets -> Approvals tab")
    print("    before   [Approve] [Reject] on the row itself")
    print("    after    the whole row opens the timesheet; one [Review] button")
    print("             Generate Invoice stays (it needs no reading)")
    print("")
    print("  Timesheet detail page, top to bottom")
    print("    header .................. 'Awaiting your approval - review below'")
    print("    Timesheet Details grid .. every day of the period")
    print("    Approval Decision ....... [Approve] [Reject]   <- moved here")
    print("    Invoice Details")
    print("    Summary")
    print("")
    print("  Who sees the buttons")
    print("    HR ................. no  (view only, as you asked)")
    print("    RMG, Sales ......... yes")
    print("    Admin / CEO ........ yes (through isSuperAdmin)")


def main() -> int:
    global CHECK_ONLY
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="dry run, write nothing")
    args = ap.parse_args()
    CHECK_ONLY = args.check

    root = repo_root()
    print("Karnex - approve at the end of the timesheet, not the top")
    print("")
    print("Repo: " + root)
    print("")

    ok = patch_timesheets(root)
    if ok:
        write_test(root)
        summary()

    print("")
    print("=" * 64)
    if not ok:
        print("NOT APPLIED. Paste this output back to Claude.")
        return 1
    if CHECK_ONLY:
        print("Dry run only - nothing written. Re-run without --check to apply.")
        return 0
    print("Applied. Now rebuild the frontend:")
    print("")
    print("  cd F:\\AI-Interview-Model-F-V2\\frontend\\admin-dashboard")
    print("  npm run build")
    print("")
    print("Optional, proves it stays fixed:")
    print("  npx vitest run src/crm/pages/TimesheetApprovals.test.tsx")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())