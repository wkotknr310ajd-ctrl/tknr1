Attribute VB_Name = "modLeave"
Option Explicit

' 「有給申請」シートの入力内容から、開始日〜終了日の連続した有給休暇申請を1件登録する。
' 範囲内の日数分、履歴に1行ずつ(同じ申請IDで)記録する。
' (承認・却下・ロールバックは modApproval / modRollback 側で
'  同一申請IDの全行をまとめて処理するため、単独申請と同じ仕組みで動く)
Public Sub SubmitLeaveRequest()
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Sheets("有給申請")

    Dim reqName As String, pwd As String, reason As String
    reqName = Trim$(CStr(ws.Range("B3").Value))
    pwd = CStr(ws.Range("B4").Value)
    reason = CStr(ws.Range("B7").Value)

    If reqName = "" Then
        MsgBox "申請者氏名を入力してください。", vbExclamation
        Exit Sub
    End If
    If pwd = "" Then
        MsgBox "パスワードを入力してください。", vbExclamation
        Exit Sub
    End If
    If Not IsDate(ws.Range("B5").Value) Or Not IsDate(ws.Range("B6").Value) Then
        MsgBox "開始日・終了日を正しく入力してください。", vbExclamation
        Exit Sub
    End If

    Dim startDate As Date, endDate As Date
    startDate = CDate(ws.Range("B5").Value)
    endDate = CDate(ws.Range("B6").Value)
    If endDate < startDate Then
        MsgBox "終了日は開始日以降にしてください。", vbExclamation
        Exit Sub
    End If
    If endDate - startDate > 30 Then
        MsgBox "一度に申請できるのは31日分までです。期間を分けて申請してください。", vbExclamation
        Exit Sub
    End If

    Dim staffRow As Long
    staffRow = FindStaffMasterRow(reqName)
    If staffRow = 0 Then
        MsgBox reqName & " は職員マスタに登録されていません。管理者に確認してください。", vbCritical
        Exit Sub
    End If

    Dim masterWs As Worksheet
    Set masterWs = ThisWorkbook.Sheets("職員マスタ")
    Dim salt As String, storedHash As String
    salt = CStr(masterWs.Cells(staffRow, 3).Value)
    storedHash = CStr(masterWs.Cells(staffRow, 4).Value)
    If Not VerifyPassword(pwd, salt, storedHash) Then
        MsgBox "パスワードが正しくありません。", vbCritical
        ws.Range("B4").Value = ""
        Exit Sub
    End If

    Dim shiftRow As Long
    shiftRow = FindShiftStaffRow(reqName)
    If shiftRow = 0 Then
        MsgBox "シフト表に " & reqName & " の行が見つかりません。管理者に確認してください。", vbCritical
        Exit Sub
    End If

    Dim leaveCode As String
    leaveCode = Trim$(CStr(ThisWorkbook.Sheets("設定").Range("B4").Value))
    If leaveCode = "" Then leaveCode = "年"

    Dim shiftWs As Worksheet
    Set shiftWs = ThisWorkbook.Sheets("シフト表")

    ' 事前に対象期間の全日付でシフト表の列が見つかるか確認してから登録する
    Dim n As Long
    n = CLng(endDate - startDate) + 1
    Dim cols() As Long
    ReDim cols(1 To n)

    Dim d As Date, idx As Long
    idx = 0
    For d = startDate To endDate
        idx = idx + 1
        cols(idx) = FindShiftDayColumn(Day(d))
        If cols(idx) = 0 Then
            MsgBox Format(d, "m/d") & " がシフト表の対象月と一致しません(設定シートの対象年月をご確認ください)。", vbCritical
            Exit Sub
        End If
    Next d

    Dim reqId As String
    reqId = NextRequestId()

    Dim summary As String
    idx = 0
    For d = startDate To endDate
        idx = idx + 1
        Dim currentShift As String
        currentShift = CStr(shiftWs.Cells(shiftRow, cols(idx)).Value)
        AppendHistoryRow reqId, Now, reqName, reqName, d, currentShift, leaveCode, _
                          "【有給申請】" & Format(startDate, "m/d") & "〜" & Format(endDate, "m/d") & " " & reason, _
                          "申請中", "", Empty, ""
        summary = summary & Format(d, "m/d") & "(" & currentShift & "→" & leaveCode & ") "
    Next d

    MsgBox "有給申請を受け付けました。(申請ID: " & reqId & ")" & vbCrLf & summary & vbCrLf & _
           "上司の承認をお待ちください。", vbInformation

    ws.Range("B4").Value = ""
    ws.Range("B7").Value = ""

    RefreshPendingList
    ThisWorkbook.Save
End Sub
