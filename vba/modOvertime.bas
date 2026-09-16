Attribute VB_Name = "modOvertime"
Option Explicit

' 「超過勤務申請」シートの入力内容から、残業申請を1件登録する。
' 承認されると、対象日のシフト表セルの末尾に残業時間を追記する
' (元の勤務コード自体は変えず、末尾に付け足す形にする)。
Public Sub SubmitOvertimeRequest()
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Sheets("超過勤務申請")

    Dim reqName As String, pwd As String, reason As String
    reqName = Trim$(CStr(ws.Range("B3").Value))
    pwd = CStr(ws.Range("B4").Value)
    reason = CStr(ws.Range("B8").Value)

    If reqName = "" Then
        MsgBox "申請者氏名を入力してください。", vbExclamation
        Exit Sub
    End If
    If pwd = "" Then
        MsgBox "パスワードを入力してください。", vbExclamation
        Exit Sub
    End If
    If Not IsDateOrTimeValue(ws.Range("B5").Value) Then
        MsgBox "対象日を正しく入力してください。", vbExclamation
        Exit Sub
    End If
    If Not IsDateOrTimeValue(ws.Range("B6").Value) Or Not IsDateOrTimeValue(ws.Range("B7").Value) Then
        MsgBox "開始時刻・終了時刻を正しく入力してください。", vbExclamation
        Exit Sub
    End If

    Dim targetDate As Date
    targetDate = CDate(ws.Range("B5").Value)

    Dim startTime As Date, endTime As Date
    startTime = CDate(ws.Range("B6").Value)
    endTime = CDate(ws.Range("B7").Value)

    ' 時刻部分だけを比較する(日付部分は無視)。終了が開始より前なら日をまたいだとみなす。
    Dim startFrac As Double, endFrac As Double
    startFrac = startTime - Int(startTime)
    endFrac = endTime - Int(endTime)
    Dim diff As Double
    diff = endFrac - startFrac
    If diff <= 0 Then diff = diff + 1

    If diff > 0.5 Then  ' 12時間(0.5日)を超える入力はミスの可能性が高いため弾く
        MsgBox "開始時刻・終了時刻を確認してください(12時間を超える入力はできません)。", vbExclamation
        Exit Sub
    End If

    Dim totalMinutes As Long
    totalMinutes = CLng(Round(diff * 24 * 60))
    If totalMinutes <= 0 Then
        MsgBox "開始時刻・終了時刻を確認してください。", vbExclamation
        Exit Sub
    End If

    Dim hoursPart As Long, minsPart As Long
    hoursPart = totalMinutes \ 60
    minsPart = totalMinutes Mod 60
    Dim hoursLabel As String
    hoursLabel = hoursPart & "時間"
    If minsPart > 0 Then hoursLabel = hoursLabel & minsPart & "分"

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

    Dim staffCell As Range
    Set staffCell = FindShiftStaffCell(reqName)
    If staffCell Is Nothing Then
        MsgBox "シフト表に " & reqName & " の行が見つかりません。管理者に確認してください。", vbCritical
        Exit Sub
    End If
    Dim shiftWs As Worksheet
    Set shiftWs = staffCell.Worksheet
    Dim shiftRow As Long
    shiftRow = staffCell.Row
    Dim shiftCol As Long
    shiftCol = FindShiftDayColumn(shiftWs, Day(targetDate))
    If shiftCol = 0 Then
        MsgBox "対象日が " & shiftWs.Name & " の対象月と一致しません(設定シートの対象年月をご確認ください)。", vbCritical
        Exit Sub
    End If

    Dim currentShift As String
    currentShift = CStr(shiftWs.Cells(shiftRow, shiftCol).Value)

    Dim newShift As String
    newShift = currentShift & "(残" & hoursLabel & ")"

    Dim reqId As String
    reqId = NextRequestId()

    AppendHistoryRow reqId, Now, reqName, reqName, targetDate, currentShift, newShift, _
                      "【超過勤務申請】" & Format(startTime, "hh:mm") & "〜" & Format(endTime, "hh:mm") & _
                      "(" & hoursLabel & ") " & reason, _
                      "申請中", "", Empty, "", "残業"

    MsgBox "超過勤務申請を受け付けました。(申請ID: " & reqId & ")" & vbCrLf & _
           Format(targetDate, "m/d") & ": " & currentShift & " → " & newShift & vbCrLf & _
           "上司の承認をお待ちください。", vbInformation

    ws.Range("B4").Value = ""
    ws.Range("B8").Value = ""

    RefreshPendingList
    RefreshAllCategoryHistory
    ThisWorkbook.Save
End Sub
