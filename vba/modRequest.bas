Attribute VB_Name = "modRequest"
Option Explicit

' 「申請」シートの入力内容から勤務変更申請を1件登録する。
' シフト表への反映はここでは行わず、履歴シートに「申請中」として記録するのみ。
Public Sub SubmitRequest()
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Sheets("申請")

    Dim reqName As String, pwd As String, newShift As String, reason As String
    reqName = Trim$(CStr(ws.Range("B3").Value))
    pwd = CStr(ws.Range("B4").Value)
    newShift = Trim$(CStr(ws.Range("B7").Value))
    reason = CStr(ws.Range("B8").Value)

    If reqName = "" Then
        MsgBox "申請者氏名を入力してください。", vbExclamation
        Exit Sub
    End If
    If Not IsDateOrTimeValue(ws.Range("B5").Value) Then
        MsgBox "対象日を正しく入力してください。", vbExclamation
        Exit Sub
    End If
    Dim reqDate As Date
    reqDate = CDate(ws.Range("B5").Value)

    If pwd = "" Then
        MsgBox "パスワードを入力してください。", vbExclamation
        Exit Sub
    End If
    If newShift = "" Then
        MsgBox "変更後の勤務内容を入力してください。", vbExclamation
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
    shiftCol = FindShiftDayColumn(shiftWs, Day(reqDate))
    If shiftCol = 0 Then
        MsgBox "対象日が " & shiftWs.Name & " の対象月と一致しません(設定シートの対象年月をご確認ください)。", vbCritical
        Exit Sub
    End If

    Dim currentShift As String
    currentShift = CStr(shiftWs.Cells(shiftRow, shiftCol).Value)

    If currentShift = newShift Then
        MsgBox "変更前と変更後の内容が同じです。", vbExclamation
        Exit Sub
    End If

    Dim reqId As String
    reqId = NextRequestId()

    AppendHistoryRow reqId, Now, reqName, reqName, reqDate, currentShift, newShift, reason, "申請中", "", Empty, "", "勤務変更"

    MsgBox "申請を受け付けました。(申請ID: " & reqId & ")" & vbCrLf & "上司の承認をお待ちください。", vbInformation

    ws.Range("B4").Value = ""
    ws.Range("B7").Value = ""
    ws.Range("B8").Value = ""

    RefreshPendingList
    RefreshAllCategoryHistory
    ThisWorkbook.Save
End Sub
