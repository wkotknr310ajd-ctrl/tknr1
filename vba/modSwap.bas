Attribute VB_Name = "modSwap"
Option Explicit

' 「交換申請」シートの入力内容から、2名間の勤務交換申請を1件登録する。
' 履歴には対象者A・対象者Bそれぞれの変更を1行ずつ、同じ申請IDで記録する。
' (承認・却下・ロールバックは modApproval / modRollback 側で
'  同一申請IDの全行をまとめて処理するため、単独申請と同じ仕組みで動く)
Public Sub SubmitSwapRequest()
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Sheets("交換申請")

    Dim reqName As String, pwd As String
    reqName = Trim$(CStr(ws.Range("B3").Value))
    pwd = CStr(ws.Range("B4").Value)

    Dim nameA As String, newShiftA As String
    Dim nameB As String, newShiftB As String
    Dim reason As String
    nameA = Trim$(CStr(ws.Range("B6").Value))
    newShiftA = Trim$(CStr(ws.Range("B9").Value))
    nameB = Trim$(CStr(ws.Range("B11").Value))
    newShiftB = Trim$(CStr(ws.Range("B14").Value))
    reason = CStr(ws.Range("B16").Value)

    If reqName = "" Then
        MsgBox "申請者氏名を入力してください。", vbExclamation
        Exit Sub
    End If
    If pwd = "" Then
        MsgBox "パスワードを入力してください。", vbExclamation
        Exit Sub
    End If
    If nameA = "" Or nameB = "" Then
        MsgBox "対象者A・対象者Bの氏名を入力してください。", vbExclamation
        Exit Sub
    End If
    If Not IsDate(ws.Range("B7").Value) Or Not IsDate(ws.Range("B12").Value) Then
        MsgBox "対象日A・対象日Bを正しく入力してください。", vbExclamation
        Exit Sub
    End If
    Dim dateA As Date, dateB As Date
    dateA = CDate(ws.Range("B7").Value)
    dateB = CDate(ws.Range("B12").Value)
    If nameA = nameB And dateA = dateB Then
        MsgBox "対象者Aと対象者Bが同一人物・同一日です。異なる組み合わせを指定してください。", vbExclamation
        Exit Sub
    End If
    If newShiftA = "" Or newShiftB = "" Then
        MsgBox "変更後の勤務(A・B双方)を入力してください。", vbExclamation
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

    If FindStaffMasterRow(nameA) = 0 Then
        MsgBox nameA & " は職員マスタに登録されていません。管理者に確認してください。", vbCritical
        Exit Sub
    End If
    If FindStaffMasterRow(nameB) = 0 Then
        MsgBox nameB & " は職員マスタに登録されていません。管理者に確認してください。", vbCritical
        Exit Sub
    End If

    Dim rowA As Long, colA As Long, rowB As Long, colB As Long
    rowA = FindShiftStaffRow(nameA)
    colA = FindShiftDayColumn(Day(dateA))
    rowB = FindShiftStaffRow(nameB)
    colB = FindShiftDayColumn(Day(dateB))
    If rowA = 0 Or colA = 0 Then
        MsgBox "シフト表に " & nameA & " の対象日が見つかりません。", vbCritical
        Exit Sub
    End If
    If rowB = 0 Or colB = 0 Then
        MsgBox "シフト表に " & nameB & " の対象日が見つかりません。", vbCritical
        Exit Sub
    End If

    Dim shiftWs As Worksheet
    Set shiftWs = ThisWorkbook.Sheets("シフト表")
    Dim currentA As String, currentB As String
    currentA = CStr(shiftWs.Cells(rowA, colA).Value)
    currentB = CStr(shiftWs.Cells(rowB, colB).Value)

    Dim reqId As String
    reqId = NextRequestId()

    AppendHistoryRow reqId, Now, reqName, nameA, dateA, currentA, newShiftA, _
                      "【交換申請】相手: " & nameB & "(" & Format(dateB, "m/d") & ") " & reason, _
                      "申請中", "", Empty, ""
    AppendHistoryRow reqId, Now, reqName, nameB, dateB, currentB, newShiftB, _
                      "【交換申請】相手: " & nameA & "(" & Format(dateA, "m/d") & ") " & reason, _
                      "申請中", "", Empty, ""

    MsgBox "交換申請を受け付けました。(申請ID: " & reqId & ")" & vbCrLf & _
           nameA & "(" & Format(dateA, "m/d") & "): " & currentA & " → " & newShiftA & vbCrLf & _
           nameB & "(" & Format(dateB, "m/d") & "): " & currentB & " → " & newShiftB & vbCrLf & _
           "上司の承認をお待ちください。", vbInformation

    ws.Range("B4").Value = ""
    ws.Range("B9").Value = ""
    ws.Range("B14").Value = ""
    ws.Range("B16").Value = ""

    RefreshPendingList
    ThisWorkbook.Save
End Sub
