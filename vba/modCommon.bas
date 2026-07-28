Attribute VB_Name = "modCommon"
Option Explicit

' シート保護は「誤操作防止」のためのものであり、真の権限管理ではありません。
' 実際の承認権限はユーザーごとのパスワードハッシュ(職員マスタシート)で判定しています。
Public Const SHEET_PROTECT_PASSWORD As String = "shift-sys-2026"

Public Sub ApplyProtection()
    Dim targets As Variant
    targets = Array("シフト表", "履歴")
    Dim t As Variant
    For Each t In targets
        With ThisWorkbook.Sheets(CStr(t))
            On Error Resume Next
            .Unprotect Password:=SHEET_PROTECT_PASSWORD
            On Error GoTo 0
            .Protect Password:=SHEET_PROTECT_PASSWORD, UserInterfaceOnly:=True, _
                     AllowFiltering:=True, AllowSorting:=False
        End With
    Next t
End Sub

Public Function NextRequestId() As String
    Dim cfg As Worksheet
    Set cfg = ThisWorkbook.Sheets("設定")
    Dim n As Long
    n = CLng(cfg.Range("B2").Value)
    n = n + 1
    cfg.Range("B2").Value = n
    NextRequestId = "REQ-" & Format(n, "000000")
End Function

Public Function Now2() As Date
    Now2 = Now
End Function

' 申請者(誰が申請したか)と対象者(誰の勤務が変わるか)は別項目として記録する。
' 単独の勤務変更申請では申請者=対象者だが、2名間の交換申請では異なる場合がある。
Public Sub AppendHistoryRow(ByVal reqId As String, ByVal appliedAt As Date, ByVal applicant As String, _
                             ByVal targetPerson As String, ByVal targetDate As Date, _
                             ByVal beforeShift As String, ByVal afterShift As String, _
                             ByVal reason As String, ByVal status As String, ByVal approver As String, _
                             ByVal approvedAt As Variant, ByVal origReqId As String)
    Dim hist As Worksheet
    Set hist = ThisWorkbook.Sheets("履歴")
    Dim r As Long
    r = hist.Cells(hist.Rows.Count, 1).End(xlUp).Row + 1
    If r < 2 Then r = 2

    hist.Cells(r, 1).Value = reqId
    hist.Cells(r, 2).Value = appliedAt
    hist.Cells(r, 2).NumberFormat = "yyyy/mm/dd hh:mm:ss"
    hist.Cells(r, 3).Value = applicant
    hist.Cells(r, 4).Value = targetPerson
    hist.Cells(r, 5).Value = targetDate
    hist.Cells(r, 5).NumberFormat = "yyyy/mm/dd"
    hist.Cells(r, 6).Value = beforeShift
    hist.Cells(r, 7).Value = afterShift
    hist.Cells(r, 8).Value = reason
    hist.Cells(r, 9).Value = status
    hist.Cells(r, 10).Value = approver
    If Not IsEmpty(approvedAt) Then
        If Trim$(CStr(approvedAt)) <> "" Then
            hist.Cells(r, 11).Value = CDate(approvedAt)
            hist.Cells(r, 11).NumberFormat = "yyyy/mm/dd hh:mm:ss"
        End If
    End If
    hist.Cells(r, 12).Value = origReqId
End Sub

Public Function FindStaffMasterRow(ByVal staffName As String) As Long
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Sheets("職員マスタ")
    Dim lastRow As Long
    lastRow = ws.Cells(ws.Rows.Count, 1).End(xlUp).Row
    Dim r As Long
    For r = 2 To lastRow
        If Trim$(CStr(ws.Cells(r, 1).Value)) = Trim$(staffName) Then
            FindStaffMasterRow = r
            Exit Function
        End If
    Next r
    FindStaffMasterRow = 0
End Function

Public Function FindShiftStaffRow(ByVal staffName As String) As Long
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Sheets("シフト表")
    Dim lastRow As Long
    lastRow = ws.Cells(ws.Rows.Count, 1).End(xlUp).Row
    Dim r As Long
    For r = 5 To lastRow
        If Trim$(CStr(ws.Cells(r, 1).Value)) = Trim$(staffName) Then
            FindShiftStaffRow = r
            Exit Function
        End If
    Next r
    FindShiftStaffRow = 0
End Function

Public Function FindShiftDayColumn(ByVal dayNum As Integer) As Long
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Sheets("シフト表")
    Dim c As Long
    For c = 2 To 32
        If IsNumeric(ws.Cells(3, c).Value) Then
            If CLng(ws.Cells(3, c).Value) = dayNum Then
                FindShiftDayColumn = c
                Exit Function
            End If
        End If
    Next c
    FindShiftDayColumn = 0
End Function

' 同じ申請IDを持つ履歴行をすべて返す。
' 単独申請なら1行、2名間の交換申請なら2行(対象者ごとに1行)が返る。
Public Function FindHistoryRowsById(ByVal reqId As String) As Collection
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Sheets("履歴")
    Dim result As New Collection
    Dim lastRow As Long
    lastRow = ws.Cells(ws.Rows.Count, 1).End(xlUp).Row
    Dim r As Long
    For r = 2 To lastRow
        If Trim$(CStr(ws.Cells(r, 1).Value)) = Trim$(reqId) Then
            result.Add r
        End If
    Next r
    Set FindHistoryRowsById = result
End Function
